import type { ReactNode } from "react";
import { Sparkles, Info } from "lucide-react";
import { fmtInt } from "../lib/fmt";

/** Shared pieces for the ported dashboard tabs (Card Law card, grounded insight, chart tooltip). */

export function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-[var(--oo-border)] p-3 text-[12px] shadow-lg" style={{ borderRadius: "var(--oo-card-radius)" }}>
      {label != null && <div className="text-[var(--oo-muted)] mb-1.5 font-semibold">{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.payload?.color }} />
          <span className="font-semibold text-[var(--oo-heading)]">{fmtInt(p.value)}</span>
          <span className="text-[var(--oo-muted)]">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

export function Insight({ text }: { text: string }) {
  return (
    <div className="insight">
      <div className="t"><Sparkles size={11} /> AI insight</div>
      <p>{text}</p>
    </div>
  );
}

/** A quiet honesty note — used where a prototype feature can't be backed by the real data. */
export function DataNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 mt-3 text-[12px] leading-snug text-[var(--oo-muted)]">
      <Info size={12} className="shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

export function Card({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="card">
      <div className="ch">
        <div>
          <h2>{title}</h2>
          {sub && <div className="sub">{sub}</div>}
        </div>
      </div>
      <div className="cb">{children}</div>
    </div>
  );
}
