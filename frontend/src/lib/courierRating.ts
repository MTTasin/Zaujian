/**
 * Pathao v2 stopped sharing per-merchant parcel counts (`show_count: false`) and
 * returns a grading instead: a bucket like "excellent_customer" / "new_customer",
 * sometimes with a `risk_level` and a human message. These render that honestly.
 *
 * The documented buckets are excellent / good / moderate / risky / new customer,
 * but the enum is Pathao's to change, so tones are matched on substrings and an
 * unseen value degrades to "unknown" — never to "good".
 */

const GOOD = "bg-emerald-100 text-emerald-700";
const BAD = "bg-red-100 text-red-700";
const WARN = "bg-amber-100 text-amber-700";
const UNKNOWN = "bg-slate-100 text-slate-600";

export function ratingLabel(raw: string): string {
  return raw.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function ratingTone(raw: string): string {
  const r = raw.toLowerCase();
  if (r.includes("excellent") || r.includes("good")) return GOOD;
  if (r.includes("bad") || r.includes("risk") || r.includes("poor")) return BAD;
  if (r.includes("new")) return UNKNOWN;
  return WARN;
}

/** "low" -> "Low risk". */
export function riskLabel(raw: string): string {
  return `${ratingLabel(raw)} risk`;
}

/** Same fail-safe rule as ratingTone: only an explicit "low" reads as green. */
export function riskTone(raw: string): string {
  const r = raw.toLowerCase();
  if (r.includes("low")) return GOOD;
  if (r.includes("high") || r.includes("severe") || r.includes("critical")) return BAD;
  if (r.includes("medium") || r.includes("moderate")) return WARN;
  return UNKNOWN;
}
