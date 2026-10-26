export type Status = "ACTIVE" | "PAST_DUE" | "CANCELED";

/** Stripe's states in the three we use. A trial counts as paid. */
export function statusFromStripe(status: string): Status {
  if (status === "active" || status === "trialing") return "ACTIVE";
  if (status === "past_due" || status === "unpaid" || status === "incomplete") return "PAST_DUE";
  return "CANCELED"; // canceled, incomplete_expired, paused
}

export const toIntervalFromStripe = (interval: string | undefined): "MONTH" | "YEAR" => (interval === "year" ? "YEAR" : "MONTH");
