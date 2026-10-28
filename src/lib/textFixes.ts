export interface Fixes {
  name?: string;
  subtitle?: string;
  offerText?: string;
}

export const FIX_FIELDS = ["name", "subtitle", "offerText"] as const;
export type FixField = (typeof FIX_FIELDS)[number];

export const FIX_MAX_LENGTH: Record<FixField, number> = { name: 120, subtitle: 120, offerText: 100 };
export const FIX_MAX_CHANGE_RATIO = 0.3;
export const FIX_MIN_CHANGE_CHARS = 3;

export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

export function acceptableFixes(current: Record<FixField, string | null>, proposed: Fixes): Fixes {
  const kept: Fixes = {};
  for (const field of FIX_FIELDS) {
    const original = current[field]?.trim() ?? "";
    const fix = proposed[field]?.trim() ?? "";
    if (!original || !fix || fix === original || fix.length > FIX_MAX_LENGTH[field]) continue;
    if (editDistance(original, fix) > Math.max(FIX_MIN_CHANGE_CHARS, Math.ceil(original.length * FIX_MAX_CHANGE_RATIO))) continue;
    kept[field] = fix;
  }
  return kept;
}