import { prisma } from "../db.js";
import { newCode } from "./code.js";
import { type SlugSource, numberedSlug, slugCandidates, slugify } from "./slug.js";

export const SLUG_SUGGESTIONS = 3;

const FIRST_NUMBER = 2;
const NUMBER_BATCH = 10;
const MAX_NUMBER_BATCHES = 5;
const FALLBACK_WORD = "page";
const FALLBACK_CODE_LENGTH = 5;
const UNIQUE_VIOLATION = "P2002";

export const SLUG_RESULT = { ok: "ok", taken: "taken", locked: "locked" } as const;
export type SlugResult = (typeof SLUG_RESULT)[keyof typeof SLUG_RESULT];

export type TakenLookup = (slugs: string[]) => Promise<Set<string>>;

export async function pickFreeSlugs(source: SlugSource, taken: TakenLookup, wanted = SLUG_SUGGESTIONS): Promise<string[]> {
  const candidates = slugCandidates(source);
  const named = candidates.length > 0 ? candidates : [slugify(`${FALLBACK_WORD} ${newCode(FALLBACK_CODE_LENGTH)}`)];
  const base = named[0] ?? FALLBACK_WORD;
  const free: string[] = [];
  const seen = new Set<string>();

  const consider = async (batch: string[]) => {
    const fresh = batch.filter((slug) => !seen.has(slug));
    for (const slug of fresh) seen.add(slug);
    const used = await taken(fresh);
    for (const slug of fresh) if (!used.has(slug) && free.length < wanted) free.push(slug);
  };

  await consider(named);
  for (let batch = 0; batch < MAX_NUMBER_BATCHES && free.length < wanted; batch++) {
    const start = FIRST_NUMBER + batch * NUMBER_BATCH;
    await consider(Array.from({ length: NUMBER_BATCH }, (_, i) => numberedSlug(base, start + i)));
  }
  return free;
}

export async function takenSlugs(slugs: string[], exceptBusinessId?: string): Promise<Set<string>> {
  if (slugs.length === 0) return new Set();
  const rows = await prisma.business.findMany({
    where: { slug: { in: slugs }, ...(exceptBusinessId ? { id: { not: exceptBusinessId } } : {}) },
    select: { slug: true },
  });
  return new Set(rows.flatMap((row) => (row.slug ? [row.slug] : [])));
}

export function freeSlugsFor(businessId: string, source: SlugSource, wanted = SLUG_SUGGESTIONS): Promise<string[]> {
  return pickFreeSlugs(source, (slugs) => takenSlugs(slugs, businessId), wanted);
}

export async function claimSlug(businessId: string, slug: string): Promise<SlugResult> {
  try {
    const result = await prisma.business.updateMany({ where: { id: businessId, slugLockedAt: null }, data: { slug } });
    return result.count > 0 ? SLUG_RESULT.ok : SLUG_RESULT.locked;
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) return SLUG_RESULT.taken;
    throw err;
  }
}