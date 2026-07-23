import { Info, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";

/**
 * STAT TILE (REVAMP B2) — ported from the prototype's D2 semantics.
 *
 * The live dashboard's tiles mixed semantics: "Total students: 606" (a total) sat beside
 * "Active Students: 2" (a delta) in identical styling. Every tile here MUST declare its
 * `type`, so a total can never be mistaken for a delta.
 *
 * `goodDirection` decouples arrow direction from colour: dropout ↑ is red even though the
 * arrow points up; mainstreamed ↑ is green.
 */

export type StatType = "total" | "rate" | "delta";

const TYPE_LABEL: Record<StatType, string> = {
  total: "TOTAL",
  rate: "RATE",
  delta: "CHANGE",
};

export function StatTile({
  label,
  value,
  sub,
  type,
  info,
  delta,
  coverage,
}: {
  label: string;
  /** Pre-formatted via fmt.ts — the tile never formats numbers itself. */
  value: string;
  sub?: string;
  /** Mandatory: what kind of number this is. */
  type: StatType;
  /** Mandatory one-sentence (i) tooltip. */
  info: string;
  /** Only where a previous period genuinely exists in the data. */
  delta?: { value: string; direction: "up" | "down"; goodDirection: "up" | "down" };
  /** Coverage caption (D5): shown whenever the metric is computed over partial data. */
  coverage?: { text: string; low: boolean };
}) {
  const isGood = delta ? delta.direction === delta.goodDirection : undefined;

  return (
    <div
      className="flex flex-col bg-[var(--oo-surface)] border border-[var(--oo-border)] p-6"
      style={{ borderRadius: "var(--oo-card-radius)", boxShadow: "var(--oo-card-shadow)" }}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--oo-muted)] truncate">
            {label}
          </span>
          {/* the type badge is what stops two tiles mixing semantics */}
          <span className="shrink-0 text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded-sm bg-[var(--oo-canvas)] text-[var(--oo-indigo)] border border-[var(--oo-border)]">
            {TYPE_LABEL[type]}
          </span>
        </div>
        <span
          tabIndex={0}
          title={info}
          aria-label={info}
          className="shrink-0 w-5 h-5 rounded-full border border-[var(--oo-input-border)] text-[var(--oo-muted)]
                     flex items-center justify-center cursor-help hover:border-[var(--oo-primary)]
                     hover:text-[var(--oo-primary)] focus:outline-none transition-colors"
        >
          <Info size={11} />
        </span>
      </div>

      <div className="font-head text-[34px] font-bold leading-none tracking-tight text-[var(--oo-heading)]">
        {value}
      </div>

      {sub && <div className="text-[13px] text-[var(--oo-text)] mt-2">{sub}</div>}

      {delta && (
        <div
          className="flex items-center gap-1.5 mt-3 text-[13px] font-semibold"
          style={{ color: isGood ? "var(--oo-success)" : "var(--oo-danger)" }}
        >
          {delta.direction === "up" ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
          <span>{delta.value}</span>
        </div>
      )}

      {coverage && (
        <div
          className={`flex items-start gap-1.5 mt-3 pt-3 border-t border-[var(--oo-border)] text-[11px] leading-snug ${
            coverage.low ? "text-[#8a4a1d]" : "text-[var(--oo-muted)]"
          }`}
        >
          {coverage.low && <AlertTriangle size={11} className="shrink-0 mt-0.5 text-[var(--oo-warning)]" />}
          <span>{coverage.text}</span>
        </div>
      )}
    </div>
  );
}

export default StatTile;
