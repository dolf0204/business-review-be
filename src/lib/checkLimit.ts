export const CHECK_WINDOW_MS = 60 * 60 * 1000;
export const MAX_CHECKS_PER_WINDOW = 6;

const recent = new Map<string, number[]>();

export function takeCheckSlot(businessId: string, now = Date.now()): boolean {
  const kept = (recent.get(businessId) ?? []).filter((t) => now - t < CHECK_WINDOW_MS);
  if (kept.length >= MAX_CHECKS_PER_WINDOW) {
    recent.set(businessId, kept);
    return false;
  }
  recent.set(businessId, [...kept, now]);
  return true;
}

export function resetCheckSlots(): void {
  recent.clear();
}