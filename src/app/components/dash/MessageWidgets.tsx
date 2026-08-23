import { useState } from "react";
import {
  Users, GraduationCap, CalendarCheck, MapPin, TrendingDown, Percent, Award, BarChart3,
  ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import type { DashboardWidget } from "../../lib/dashboard-types";
import { WidgetChart, inferGoodDirection } from "./WidgetChart";

/**
 * Renders an answer as a DASHBOARD: a row of KPI stat cards, then charts/tables in a responsive
 * grid (so a prompt produces a real dashboard view, not a single stacked chart). Everything is
 * width-contained (`min-w-0`, tables scroll in their own box) so the surface never scrolls sideways.
 */

/** Pick a stat-card icon from the metric label — a small visual cue like a real dashboard KPI. */
function iconFor(label: string) {
  const s = label.toLowerCase();
  if (/student|enrol|learner|girl|boy|child|pupil/.test(s)) return Users;
  if (/teacher|educator|staff/.test(s)) return GraduationCap;
  if (/attendance|present/.test(s)) return CalendarCheck;
  if (/centre|center/.test(s)) return MapPin;
  if (/dropout|leave|risk|lowest|worst|deficit/.test(s)) return TrendingDown;
  if (/mainstream|rate|percent|coverage|%/.test(s)) return Percent;
  if (/mark|score|subject|exam|avg|average|grow/.test(s)) return Award;
  return BarChart3;
}

function StatCards({ widget }: { widget: DashboardWidget }) {
  const items = widget.metricsList ?? [];
  if (!items.length) return null;
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
      {items.map((m, i) => {
        const Icon = iconFor(m.label);
        const hasTrend = !!m.trend && m.trendDirection && m.trendDirection !== "neutral";
        const good = hasTrend ? inferGoodDirection(m.label) === m.trendDirection : undefined;
        const TrendIcon = m.trendDirection === "down" ? ArrowDownRight : ArrowUpRight;
        return (
          <div
            key={i}
            className="bg-white border border-[var(--oo-border)] rounded-xl p-3.5 min-w-0"
            style={{ boxShadow: "var(--oo-card-shadow)" }}
          >
            <div className="flex items-center justify-between mb-2.5">
              <span
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--oo-primary) 12%, transparent)", color: "var(--oo-primary)" }}
              >
                <Icon size={15} />
              </span>
              {hasTrend && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10.5px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{
                    color: good ? "var(--oo-success)" : "var(--oo-danger)",
                    background: good ? "color-mix(in srgb, var(--oo-success) 12%, transparent)" : "color-mix(in srgb, var(--oo-danger) 12%, transparent)",
                  }}
                >
                  <TrendIcon size={11} />{m.trend}
                </span>
              )}
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--oo-muted)] truncate">{m.label}</div>
            <div className="font-head text-[21px] font-bold text-[var(--oo-heading)] leading-tight mt-0.5 break-words">{m.value}</div>
            {m.sub && <div className="text-[10.5px] text-[var(--oo-muted)] mt-0.5 leading-snug break-words">{m.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}

const CHART_TYPES = ["bar", "line", "area", "pie"] as const;

function ChartBlock({ widget, fill }: { widget: DashboardWidget; fill?: boolean }) {
  // Every chart type stays available — the widget only picks the sensible DEFAULT. Switching is the
  // reader's call, so the toggles are never withheld.
  const [type, setType] = useState<(typeof CHART_TYPES)[number]>(
    (CHART_TYPES.includes(widget.chartType as (typeof CHART_TYPES)[number]) ? widget.chartType : "bar") as (typeof CHART_TYPES)[number]
  );
  return (
    <div
      className={`bg-white border border-[var(--oo-border)] p-4 min-w-0 overflow-hidden h-full ${fill ? "flex flex-col" : ""}`}
      style={{ borderRadius: "14px", boxShadow: "var(--oo-card-shadow)" }}
    >
      <div className="flex items-start justify-between gap-2 mb-3 shrink-0">
        <div className="min-w-0">
          <div className="text-[11.5px] font-bold text-[var(--oo-heading)] break-words">{widget.title}</div>
          {widget.caption && (
            <div className="text-[10px] text-[var(--oo-muted)] leading-snug mt-0.5 break-words">{widget.caption}</div>
          )}
        </div>
        <div className="flex bg-[var(--oo-canvas)] border border-[var(--oo-border)] rounded-md p-0.5 gap-0.5 shrink-0">
          {CHART_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded transition-colors cursor-pointer ${
                type === t ? "bg-white text-[var(--oo-primary)] shadow-sm" : "text-[var(--oo-muted)] hover:text-[var(--oo-heading)]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      {fill ? (
        // ResponsiveContainer can't measure a flex/grid parent reliably; an absolutely-positioned
        // box gives it a concrete size so the chart fills the cell instead of collapsing to ~0.
        <div className="flex-1 min-h-0 relative min-w-0">
          <div className="absolute inset-0">
            <WidgetChart widget={{ ...widget, chartType: type }} height="100%" />
          </div>
        </div>
      ) : (
        <div className="min-w-0">
          <WidgetChart widget={{ ...widget, chartType: type }} height={280} />
        </div>
      )}
    </div>
  );
}

function TableBlock({ widget }: { widget: DashboardWidget }) {
  return (
    <div
      className="bg-white border border-[var(--oo-border)] p-4 min-w-0 h-full"
      style={{ borderRadius: "14px", boxShadow: "var(--oo-card-shadow)" }}
    >
      <div className="mb-3">
        <div className="text-[11.5px] font-bold text-[var(--oo-heading)] break-words">{widget.title}</div>
        {widget.caption && (
          <div className="text-[10px] text-[var(--oo-muted)] leading-snug mt-0.5 break-words">{widget.caption}</div>
        )}
      </div>
      <div className="overflow-x-auto max-h-[260px] no-scrollbar">
        <table className="text-left border-collapse text-[11px] w-max min-w-full">
          <thead>
            <tr className="border-b border-[var(--oo-border)] bg-[var(--oo-canvas)] text-[9px] text-[var(--oo-muted)] uppercase font-mono">
              {widget.tableHeaders?.map((h) => (
                <th key={h} className="p-2 font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--oo-border)]">
            {widget.data?.map((row, rIdx) => (
              <tr key={rIdx} className="hover:bg-[var(--oo-canvas)]/60 transition-colors">
                {widget.tableHeaders?.map((h) => (
                  <td key={h} className="p-2 font-mono text-[10px] text-[var(--oo-text)] whitespace-nowrap">
                    {row[h] !== undefined && row[h] !== null ? row[h].toString() : "-"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TextBlock({ widget }: { widget: DashboardWidget }) {
  return (
    <div className="bg-white border border-[var(--oo-border)] p-4 min-w-0 h-full" style={{ borderRadius: "14px", boxShadow: "var(--oo-card-shadow)" }}>
      <div className="text-[11.5px] font-bold text-[var(--oo-heading)] mb-2 break-words">{widget.title}</div>
      <div className="text-[12px] text-[var(--oo-text)] leading-relaxed whitespace-pre-wrap break-words">{widget.content}</div>
    </div>
  );
}

export function MessageWidgets({ widgets, fill }: { widgets?: DashboardWidget[]; fill?: boolean }) {
  if (!widgets || widgets.length === 0) return null;
  const metrics = widgets.filter((w) => w.type === "metrics");
  const rest = widgets.filter((w) => w.type !== "metrics");

  const renderItem = (w: DashboardWidget, i: number) => {
    // Charts flow into the grid (2-up); tables & prose span the full width.
    const full = w.type === "table" || w.type === "text";
    const inner =
      w.type === "chart" ? <ChartBlock widget={w} fill={fill} /> :
      w.type === "table" ? <TableBlock widget={w} /> :
      <TextBlock widget={w} />;
    return (
      <div key={`r${i}`} className={`min-w-0 ${fill ? "h-full" : ""}`} style={full ? { gridColumn: "1 / -1" } : undefined}>
        {inner}
      </div>
    );
  };

  // FILL mode — a single dashboard that fits the screen (no page scroll): KPI row on top, charts
  // stretch to fill the remaining height. Height flows through FLEX (reliable), never percentages.
  if (fill) {
    const cols = Math.min(rest.length || 1, 2);
    return (
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        {metrics.length > 0 && (
          <div className="shrink-0 flex flex-col gap-3">
            {metrics.map((w, i) => <StatCards key={`m${i}`} widget={w} />)}
          </div>
        )}
        {rest.length > 0 && (
          <div
            className="flex-1 min-h-0 grid gap-3"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}
          >
            {rest.map(renderItem)}
          </div>
        )}
      </div>
    );
  }

  // SCROLL mode — the threaded chat surface. Charts sit in their own grid that is full-width for a
  // single chart (2-up only when there are several), so a lone chart fills the row instead of leaving
  // blank tracks beside it. Tables & prose always span the full width below.
  const charts = rest.filter((w) => w.type === "chart");
  const others = rest.filter((w) => w.type !== "chart");
  return (
    <div className="mt-3 space-y-3 min-w-0">
      {metrics.map((w, i) => <StatCards key={`m${i}`} widget={w} />)}
      {charts.length > 0 && (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(charts.length, 2)}, minmax(0, 1fr))` }}>
          {charts.map((w, i) => (
            <div key={`c${i}`} className="min-w-0"><ChartBlock widget={w} /></div>
          ))}
        </div>
      )}
      {others.map((w, i) => (
        <div key={`o${i}`} className="min-w-0">
          {w.type === "table" ? <TableBlock widget={w} /> : <TextBlock widget={w} />}
        </div>
      ))}
    </div>
  );
}

export default MessageWidgets;
