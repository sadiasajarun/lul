import { Info } from "lucide-react";
import type { ReactNode } from "react";

/**
 * THE CARD LAW (REVAMP C2) — one card anatomy for every widget.
 *
 *   head    : title (18/600) + meta (13/muted) + actions incl. mandatory (i)
 *   toolbar : optional
 *   body    : the content
 *   insight : full-bleed grounded footer (mandatory on data cards)
 *
 * Spacing is fixed by the law: 24px padding, 24px between cards, 56px between sections.
 */
export function DashCard({
  title,
  meta,
  info,
  toolbar,
  insight,
  className = "",
  children,
}: {
  /** 18px/600 heading. */
  title: string;
  /** 13px muted context line — usually scope + n. */
  meta?: string;
  /** Mandatory one-sentence (i) tooltip explaining what this card shows. */
  info: string;
  toolbar?: ReactNode;
  /** Grounded insight footer. Text must be validated by validateNarrative(). */
  insight?: { text: string; tone?: "neutral" | "warn" };
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex flex-col bg-[var(--oo-surface)] border border-[var(--oo-border)] overflow-hidden ${className}`}
      style={{ borderRadius: "var(--oo-card-radius)", boxShadow: "var(--oo-card-shadow)" }}
    >
      {/* head */}
      <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4">
        <div className="min-w-0">
          <h3
            className="font-head text-[18px] font-semibold leading-tight text-[var(--oo-heading)] truncate"
            title={title}
          >
            {title}
          </h3>
          {meta && <div className="text-[13px] text-[var(--oo-muted)] mt-1 truncate">{meta}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {toolbar}
          <span
            tabIndex={0}
            title={info}
            aria-label={info}
            className="w-5 h-5 rounded-full border border-[var(--oo-input-border)] text-[var(--oo-muted)]
                       flex items-center justify-center cursor-help hover:border-[var(--oo-primary)]
                       hover:text-[var(--oo-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--oo-primary)]/30 transition-colors"
          >
            <Info size={11} />
          </span>
        </div>
      </div>

      {/* body — grows so every card in a row ends at the same line */}
      <div className="flex-1 px-6 pb-6">{children}</div>

      {/* insight — full-bleed footer */}
      {insight && (
        <div
          className={`px-6 py-4 text-[13px] leading-relaxed border-t ${
            insight.tone === "warn"
              ? "bg-[#FF9149]/8 border-[#FF9149]/25 text-[#8a4a1d]"
              : "bg-[var(--oo-canvas)] border-[var(--oo-border)] text-[var(--oo-text)]"
          }`}
        >
          {insight.text}
        </div>
      )}
    </div>
  );
}

/** Section heading — uppercase, letter-spaced, with a rule line. 56px above. */
export function SectionHead({ children, sub }: { children: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-4 mb-6" style={{ marginTop: "var(--gap-section)" }}>
      <div>
        <h2 className="font-head text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--oo-indigo)]">
          {children}
        </h2>
        {sub && <div className="text-[12px] text-[var(--oo-muted)] mt-1">{sub}</div>}
      </div>
      <div className="flex-1 h-px bg-[var(--oo-border)]" />
    </div>
  );
}

export default DashCard;
