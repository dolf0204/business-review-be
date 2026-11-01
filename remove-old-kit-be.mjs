import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const NO_GIT = process.argv.includes('--no-git');

const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'pipe' }).toString();
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const write = (rel, text) => writeFileSync(path.join(ROOT, rel), text);

const DELETE = ['src/routes/shop/kit.ts', 'src/lib/shop/kit.ts', 'test/routes/shop/kit.test.ts'];

for (const rel of DELETE) {
  if (!existsSync(path.join(ROOT, rel))) {
    console.error(`Missing ${rel}. Run the BE folder refactor first, or the kit is already removed.`);
    process.exit(1);
  }
}
if (!NO_GIT && run('git status --porcelain').trim() !== '') {
  console.error('Git tree is not clean. Commit or stash first, then run again.');
  process.exit(1);
}

function replaceOnce(rel, text, from, to) {
  const first = text.indexOf(from);
  if (first < 0 || text.indexOf(from, first + 1) >= 0) {
    throw new Error(`${rel}: expected exactly one match for "${from.slice(0, 50)}"`);
  }
  return text.replace(from, () => to);
}

const SHIP_COUNTRIES = `export const shipCountries = (raw: string) => [...new Set(raw.split(",").map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];\n`;

{
  const rel = 'src/lib/shop/catalog.ts';
  let s = read(rel);
  if (!s.endsWith('\n')) s += '\n';
  write(rel, `${s}\n${SHIP_COUNTRIES}`);
}

{
  const rel = 'src/routes/shop/shop.ts';
  let s = read(rel);
  s = replaceOnce(rel, s, 'import { shipCountries } from "../../lib/shop/kit.js";\n', '');
  s = replaceOnce(rel, s, 'publicCatalog, SHOP_CURRENCY, SIZES,', 'publicCatalog, shipCountries, SHOP_CURRENCY, SIZES,');
  write(rel, s);
}

{
  const rel = 'src/app.ts';
  let s = read(rel);
  s = replaceOnce(rel, s, 'import { kitRoutes } from "./routes/shop/kit.js";\n', '');
  s = replaceOnce(rel, s, '  await app.register(kitRoutes);\n', '');
  write(rel, s);
}

{
  const rel = 'test/lib/shop/order.test.ts';
  let s = read(rel);
  s = replaceOnce(rel, s, 'FINISHES, publicCatalog, SIZE_PRICE_CENTS }', 'FINISHES, publicCatalog, shipCountries, SIZE_PRICE_CENTS }');
  s = replaceOnce(
    rel,
    s,
    '    expect(FINISHES).toHaveLength(3);\n  });\n',
    '    expect(FINISHES).toHaveLength(3);\n  });\n  it("reads the list of countries, upper case and without junk", () => {\n    expect(shipCountries("hr, de ,XX1,,it,HR")).toEqual(["HR", "DE", "IT"]);\n  });\n'
  );
  write(rel, s);
}

{
  const rel = 'prisma/schema.prisma';
  let s = read(rel);
  s = replaceOnce(rel, s, '  kitRequests    KitRequest[]\n', '');
  const from = s.indexOf('enum KitStatus {');
  const to = s.indexOf('// A discount a business offers its guests');
  if (from < 0 || to < 0 || to < from) throw new Error(`${rel}: cannot find the KitStatus and KitRequest block`);
  s = s.slice(0, from) + s.slice(to);
  write(rel, s);
}

for (const rel of DELETE) {
  if (NO_GIT) execSync(`rm ${rel}`, { cwd: ROOT });
  else run(`git rm -q ${rel}`);
  console.log(`deleted ${rel}`);
}
console.log('done');