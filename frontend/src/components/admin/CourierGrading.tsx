import { ratingLabel, ratingTone, riskLabel, riskTone } from "@/lib/courierRating";

/** One courier's slice of `Order.fraud_check_result`. */
export interface CourierStat {
  success?: number;
  cancel?: number;
  total?: number;
  success_ratio?: number;
  error?: string;
  /** False when the courier reported no numbers at all — not the same as zero. */
  counts_available?: boolean;
  /** Pathao grades instead of counting, e.g. "excellent_customer". */
  rating?: string;
  /** Optional second signal ("low" / "medium" / "high") — not always sent. */
  risk_level?: string;
  /** Pathao's own sentence about the grade, when it sends one. */
  message?: string;
}

/**
 * What a courier says when it won't share counts. Shown INSTEAD of 0/0/0%,
 * which would read as "this customer never received a parcel".
 */
export function CourierGrading({ stat, courier }: { stat: CourierStat; courier: string }) {
  const { rating, risk_level: risk, message } = stat;
  if (!rating && !risk) return <span className="text-slate-400">No data shared</span>;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {rating && (
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ratingTone(rating)}`}>
          {ratingLabel(rating)}
        </span>
      )}
      {risk && (
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${riskTone(risk)}`}>
          {riskLabel(risk)}
        </span>
      )}
      <span className="text-xs text-slate-400">
        {message || `rating only — ${courier} no longer shares parcel counts`}
      </span>
    </span>
  );
}
