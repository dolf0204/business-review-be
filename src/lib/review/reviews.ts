// When a guest is asked for a review. Pure rules, so they are easy to test.

export const ASK_AGAIN_AFTER_VISITS = 3;

export type PlatformState = "due" | "done" | "snoozed";
export type Step = "google" | "tripadvisor" | null;

export interface PromptRow {
  status: "DONE" | "DECLINED";
  declinedAtVisit: number;
}

/** One platform: never asked, finished (the guest followed the link), or said no thanks and the waiting time has not passed yet. */
export function platformState(row: PromptRow | undefined, visits: number): PlatformState {
  if (!row) return "due";
  if (row.status === "DONE") return "done";
  return visits >= row.declinedAtVisit + ASK_AGAIN_AFTER_VISITS ? "due" : "snoozed";
}

/**
 * Google comes first, Tripadvisor only after Google is finished. A guest who declined Google is not pushed on to Tripadvisor:
 * nothing is asked until the waiting time has passed. A business without a Tripadvisor link only gets the Google step.
 */
export function nextStep(google: PlatformState, tripadvisor: PlatformState | null): Step {
  if (google === "due") return "google";
  if (google === "done" && tripadvisor === "due") return "tripadvisor";
  return null;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** A visit counts once per calendar day (UTC), however often the page is opened. */
export const isNewVisitDay = (last: Date | null, now: Date) => !last || day(last) !== day(now);
