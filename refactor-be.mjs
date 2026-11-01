import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SOURCE_SUFFIX = '.ts';
const GENERATED_DIR = 'src/generated/';
const SPEC_PATTERN = /(["'])(\.{1,2}\/[^"'\n]*)\1/g;

const LIB_GROUPS = {
  auth: { access: 'access', sessionCookie: 'sessionCookie', teardown: 'teardown', tokens: 'tokens', turnstile: 'turnstile' },
  mail: { mail: 'mail', guestMail: 'guestMail', offerMail: 'offerMail' },
  links: { operator: 'operator', unsubscribe: 'unsubscribe' },
  business: {
    businessView: 'businessView', code: 'code', live: 'live', partnerKinds: 'partnerKinds', siteUrl: 'siteUrl',
  },
  slug: { slug: 'slug', slugs: 'slugs', slugLock: 'slugLock' },
  places: { googlePlaces: 'googlePlaces', mapsUrl: 'mapsUrl', geo: 'geo' },
  media: { media: 'media', image: 'image' },
  review: {
    review: 'review', reviews: 'reviews', checkLimit: 'checkLimit', contentCheck: 'contentCheck', textFixes: 'textFixes',
  },
  engage: { loyalty: 'loyalty', campaignSend: 'campaignSend' },
  shop: { shop: 'order', shopCatalog: 'catalog', shopFulfil: 'fulfil', kit: 'kit' },
};

const BILLING_FILES = { '../lib/stripeGuard': 'stripeGuard' };

const ROUTE_GROUPS = {
  account: { auth: 'auth', billing: 'billing' },
  business: { businesses: 'businesses', slug: 'slug', uploads: 'uploads' },
  engage: { campaigns: 'campaigns', coupons: 'coupons', loyalty: 'loyalty', posts: 'posts', reviews: 'reviews' },
  shop: { shop: 'shop', kit: 'kit' },
  public: { public: 'public', guests: 'guests', partners: 'partners', operator: 'operator', health: 'health' },
};

const TEST_GROUPS = {
  'routes/account': { auth: 'auth', billing: 'billing' },
  'routes/business': { businesses: 'businesses', slugRoutes: 'slugRoutes', uploads: 'uploads', share: 'share' },
  'routes/engage': { campaigns: 'campaigns', coupons: 'coupons', loyalty: 'loyalty', posts: 'posts', reviews: 'reviews' },
  'routes/shop': { kit: 'kit', shop: 'shop' },
  'routes/public': { guests: 'guests', operator: 'operator', partners: 'partners', publicSlug: 'publicSlug' },
  'lib/business': { businessView: 'businessView', siteUrl: 'siteUrl' },
  'lib/places': { geo: 'geo', mapsUrl: 'mapsUrl', places: 'places' },
  'lib/mail': { mail: 'mail' },
  'lib/slug': { slug: 'slug', slugLock: 'slugLock', slugs: 'slugs' },
  'lib/shop': { shopPricing: 'order' },
  'lib/auth': { teardown: 'teardown' },
};

const posix = (p) => p.split(path.sep).join('/');
const abs = (p) => path.join(ROOT, p);
const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

function addMoves(moves, label, groups, oldPath, newPath) {
  for (const [group, names] of Object.entries(groups)) {
    for (const [oldName, newName] of Object.entries(names)) {
      const old = oldPath(oldName);
      if (!existsSync(abs(old))) {
        console.log(`skip (not found): ${label} ${oldName}`);
        continue;
      }
      const target = newPath(group, newName);
      if (old !== target) moves.set(old, target);
    }
  }
}

function buildMoves() {
  const moves = new Map();
  addMoves(moves, 'lib', LIB_GROUPS, (n) => `src/lib/${n}.ts`, (g, n) => `src/lib/${g}/${n}.ts`);
  addMoves(moves, 'route', ROUTE_GROUPS, (n) => `src/routes/${n}.ts`, (g, n) => `src/routes/${g}/${n}.ts`);
  addMoves(moves, 'test', TEST_GROUPS, (n) => `test/${n}.test.ts`, (g, n) => `test/${g}/${n}.test.ts`);
  for (const old of Object.keys(BILLING_FILES)) {
    const from = `src/lib/${old.split('/').pop()}.ts`;
    if (existsSync(abs(from))) moves.set(from, `src/billing/${BILLING_FILES[old]}.ts`);
    else console.log(`skip (not found): ${from}`);
  }
  return moves;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(abs(dir), { withFileTypes: true })) {
    const child = `${dir}/${entry.name}`;
    if (child === GENERATED_DIR.slice(0, -1)) continue;
    if (entry.isDirectory()) out.push(...walk(child));
    else if (entry.name.endsWith(SOURCE_SUFFIX)) out.push(child);
  }
  return out;
}

function resolveSpec(spec, importerOld, existing) {
  const base = posix(path.normalize(path.join(path.dirname(importerOld), spec)));
  if (base.startsWith(GENERATED_DIR)) return base.replace(/\.js$/, '.ts');
  const stem = base.replace(/\.js$/, '');
  return [`${stem}.ts`, `${stem}/index.ts`, base].find((c) => existing.has(c)) ?? null;
}

function newSpec(spec, targetNew, importerNew) {
  const withoutExt = targetNew.replace(/\.ts$/, '');
  const target = spec.endsWith('.js') ? `${withoutExt}.js` : withoutExt;
  const relative = posix(path.relative(path.dirname(importerNew), target));
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function main() {
  if (git('rev-parse', '--is-inside-work-tree').status !== 0) fail('Not a git repository. Run this inside business-review-be.');
  if (git('status', '--porcelain').stdout.trim() !== '') fail('Working tree is not clean. Commit or stash first, then run again.');
  if (!existsSync(abs('src/lib')) || !existsSync(abs('test'))) fail('Run this from ~/posao/business-review-be');

  const moves = buildMoves();
  const sources = [...walk('src'), ...walk('test')].sort();
  const existing = new Set(sources);
  const newLocation = new Map(sources.map((s) => [s, moves.get(s) ?? s]));

  const rewritten = new Map();
  for (const oldPath of sources) {
    const text = readFileSync(abs(oldPath), 'utf8');
    const importerNew = newLocation.get(oldPath);
    const next = text.replace(SPEC_PATTERN, (whole, quote, spec) => {
      const targetOld = resolveSpec(spec, oldPath, existing);
      if (targetOld === null) return whole;
      const targetNew = moves.get(targetOld) ?? targetOld;
      return `${quote}${newSpec(spec, targetNew, importerNew)}${quote}`;
    });
    if (next !== text) rewritten.set(oldPath, next);
  }

  for (const [old, target] of [...moves].sort()) {
    mkdirSync(path.dirname(abs(target)), { recursive: true });
    const result = git('mv', old, target);
    if (result.status !== 0) fail(`git mv failed for ${old}: ${result.stderr}`);
  }
  for (const [oldPath, text] of rewritten) writeFileSync(abs(newLocation.get(oldPath)), text);
  console.log(`moved ${moves.size} files, rewrote imports in ${rewritten.size} files`);
}

main();