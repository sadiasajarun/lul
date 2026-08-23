import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, LineChart, Line, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, AreaChart, Area, Cell, PieChart, Pie, Legend, LabelList
} from "recharts";
import { AlertTriangle } from "lucide-react";
import type { DashboardWidget } from "../../lib/dashboard-types";
import type { StatType } from "./StatTile";

/**
 * Shared widget-chart renderer, extracted from AIDashboardView so the AI analysis grid and the
 * inline chat widgets render through ONE code path. The rules here are the prototype's:
 * a widget whose data doesn't match its declared shape fails visibly (C3), never silently.
 */

/**
 * A metric from the LLM declares no semantics, so infer them (REVAMP B2: no tile may render
 * without a type). Percent/rate-ish → rate; an explicit +/- change → delta; otherwise total.
 */
export function inferStatType(m: { label: string; value: string; trend?: string }): StatType {
  const s = `${m.label} ${m.value}`.toLowerCase();
  if (/%|rate|percent|ratio|average|avg/.test(s)) return "rate";
  if (m.trend && /^[+-]/.test(m.trend.trim())) return "delta";
  return "total";
}

/** Decouple arrow direction from colour: more dropouts is bad even though the arrow points up. */
export function inferGoodDirection(label: string): "up" | "down" {
  return /dropout|drop-out|risk|critical|absent|left|concern|fail|poor|overdue/i.test(label) ? "down" : "up";
}

/** Rows must be objects and carry the keys the chart is about to read. */
export function isRenderableChart(w: DashboardWidget): boolean {
  if (!Array.isArray(w.data) || w.data.length === 0) return false;
  if (!w.xAxisKey || !Array.isArray(w.seriesKeys) || w.seriesKeys.length === 0) return false;
  const first = w.data[0];
  if (typeof first !== "object" || first === null) return false;
  return w.xAxisKey in first && w.seriesKeys.some((k) => k in first);
}

/** A malformed widget must fail visibly, never silently or as a crash (REVAMP C3). */
export function WidgetError({ title, reason }: { title: string; reason: string }) {
  return (
    <div
      className="border border-[var(--oo-warning)]/40 bg-[var(--oo-warning)]/8 p-5"
      style={{ borderRadius: "var(--oo-card-radius)" }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <AlertTriangle size={13} className="text-[var(--oo-warning)]" />
        <span className="text-[13px] font-semibold text-[#8a4a1d]">{title || "Widget"}</span>
      </div>
      <p className="text-[12px] text-[#8a4a1d]/85 leading-relaxed">
        This widget couldn't be rendered: {reason}. The underlying answer may still be correct — the
        dashboard refuses to guess at a shape it doesn't recognise.
      </p>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 text-xs shadow-lg text-slate-800">
      <div className="text-muted-foreground mb-1 font-mono">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-900 font-semibold">{p.value}{typeof p.value === "number" && p.name?.includes("Rate") ? "%" : ""}</span>
          <span className="text-muted-foreground">{p.name}</span>
        </div>
      ))}
    </div>
  );
};

// Cohesive categorical palette (indigo · teal · orange · blue · pink · cyan) — cycled in order.
const colors = ["#5B62E0", "#00B58F", "#E8862F", "#6697C6", "#CC6AC2", "#2C9AE0"];

// Fixed, high-contrast colour per NFPE programme so multi-series charts are always readable and a
// programme keeps the SAME colour across every chart, independent of series order. The two largest
// programmes (ABAL, Catchup) get the most contrasting pair (indigo vs orange). Falls back to the
// positional palette for any non-programme series (e.g. "Total", subject names).
const SERIES_COLORS: Record<string, string> = {
  abal: "#5B62E0",       // indigo
  catchup: "#E8862F",    // orange
  innovation: "#00B58F", // teal
  total: "#94A3B8",      // slate — neutral, so a "Total" series never competes with a programme
};
const colorFor = (key: string, i: number) =>
  SERIES_COLORS[String(key).trim().toLowerCase()] ?? colors[i % colors.length];
const GRID = "var(--oo-border)";

/** Render a single chart widget, or a visible error if its data doesn't match its declared shape. */
export function WidgetChart({ widget, height = 260 }: { widget: DashboardWidget; height?: number | string }) {
  const { chartType, data, xAxisKey, seriesKeys } = widget;

  // C3 · shape validation — refuse to render a widget whose data doesn't match its own spec.
  if (!isRenderableChart(widget)) {
    const reason = !Array.isArray(data) || data.length === 0
      ? "it carried no data rows"
      : !xAxisKey || !seriesKeys?.length
        ? "it didn't declare an axis or series"
        : `its rows don't contain the keys it declared (${[xAxisKey, ...(seriesKeys ?? [])].join(", ")})`;
    return <WidgetError title={widget.title} reason={reason} />;
  }

  // Past isRenderableChart() these are guaranteed present; bind them as non-optional.
  const rows = data as Record<string, unknown>[];
  const keys = seriesKeys as string[];
  const xKey = xAxisKey as string;

  // Compact axis ticks (150000 → 150k) so the Y labels never clip in the narrow dock.
  const compact = (v: number | string) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    const a = Math.abs(n);
    if (a >= 1e6) return `${Math.round(n / 1e5) / 10}M`;
    if (a >= 1e3) return `${Math.round(n / 100) / 10}k`;
    return String(n);
  };

  // Force every category label to render (Recharts otherwise silently drops overlapping ones); angle
  // them when there are many / long labels so nothing is cut, and reserve axis height for the angle.
  const many = rows.length > 6;
  const xAxisProps = {
    dataKey: xKey,
    tick: { fill: "#64748b", fontSize: 9 },
    axisLine: false,
    tickLine: false,
    interval: 0 as const,
    angle: many ? -32 : 0,
    textAnchor: (many ? "end" : "middle") as "end" | "middle",
    height: many ? 52 : 20,
  };

  switch (chartType) {
    case "bar":
      return (
        <ResponsiveContainer width="100%" height={height} minHeight={150}>
          {/* top margin holds the value labels so tall bars' labels aren't clipped */}
          <BarChart data={rows} margin={{ top: 20, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} strokeOpacity={0.7} vertical={false} />
            <XAxis {...xAxisProps} />
            <YAxis width={38} tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={compact} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--oo-canvas)" }} />
            {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />}
            {keys.map((key, i) => (
              <Bar key={key} dataKey={key} name={key} fill={colorFor(key, i)} radius={[5, 5, 0, 0]} maxBarSize={56}>
                {/* value labels only when they won't collide (≤ 14 bars, single series) */}
                {keys.length === 1 && rows.length <= 14 && <LabelList dataKey={key} position="top" fill="var(--oo-muted)" fontSize={9} formatter={compact} />}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
    case "line":
      return (
        <ResponsiveContainer width="100%" height={height} minHeight={150}>
          <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} strokeOpacity={0.7} vertical={false} />
            <XAxis {...xAxisProps} />
            <YAxis width={38} tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={compact} />
            <Tooltip content={<CustomTooltip />} />
            {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />}
            {keys.map((key, i) => (
              <Line key={key} type="monotone" dataKey={key} name={key} stroke={colorFor(key, i)} strokeWidth={2.5} activeDot={{ r: 4 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
    case "area":
      return (
        <ResponsiveContainer width="100%" height={height} minHeight={150}>
          <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} strokeOpacity={0.7} vertical={false} />
            <XAxis {...xAxisProps} />
            <YAxis width={38} tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={compact} />
            <Tooltip content={<CustomTooltip />} />
            {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />}
            {keys.map((key, i) => (
              <Area key={key} type="monotone" dataKey={key} name={key} stroke={colorFor(key, i)} fill={`${colorFor(key, i)}1c`} strokeWidth={2} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      );
    case "radar":
      return (
        <ResponsiveContainer width="100%" height={height} minHeight={150}>
          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={rows}>
            <PolarGrid stroke="rgba(0,0,0,0.06)" />
            <PolarAngleAxis dataKey={xKey} tick={{ fill: "#64748b", fontSize: 9 }} />
            <PolarRadiusAxis angle={30} domain={[0, 'auto']} />
            {keys.map((key, i) => (
              <Radar key={key} name={key} dataKey={key} stroke={colorFor(key, i)} fill={colorFor(key, i)} fillOpacity={0.2} />
            ))}
            {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />}
            <Tooltip content={<CustomTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      );
    case "pie":
      return (
        <ResponsiveContainer width="100%" height={height} minHeight={150}>
          <PieChart>
            <Pie data={rows} cx="50%" cy="50%" innerRadius={54} outerRadius={90} paddingAngle={2} dataKey={keys[0]} nameKey={xKey} stroke="#fff" strokeWidth={2}>
              {rows.map((row, index) => (
                <Cell key={`cell-${index}`} fill={colorFor(String(row[xKey]), index)} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend verticalAlign="bottom" height={36} iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 9 }} />
          </PieChart>
        </ResponsiveContainer>
      );
    case "scatter":
      return (
        <ResponsiveContainer width="100%" height={height} minHeight={150}>
          <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} strokeOpacity={0.7} vertical={false} />
            <XAxis dataKey={xKey} tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis width={38} tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={compact} />
            <Tooltip content={<CustomTooltip />} />
            <Scatter name="Data Points" data={rows} fill="#8b5cf6" />
          </ScatterChart>
        </ResponsiveContainer>
      );
    default:
      return null;
  }
}

export default WidgetChart;
