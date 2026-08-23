import { Sparkles, AlertTriangle } from "lucide-react";
import type { DynamicDashboardResponse } from "../lib/dashboard-types";
import { StatTile } from "../components/dash/StatTile";
import { WidgetChart, inferStatType, inferGoodDirection } from "../components/dash/WidgetChart";
import { narrate } from "../utils/insights";

function AIDashboardView({
  response,
  setResponse,
}: {
  response: DynamicDashboardResponse | null;
  setResponse: React.Dispatch<React.SetStateAction<DynamicDashboardResponse | null>>;
}) {
  if (!response) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground text-xs font-mono">
        No active analysis results. Submit a prompt to generate insights.
      </div>
    );
  }

  const getColSpan = (width?: "full" | "half" | "third") => {
    if (width === "full") return "col-span-6";
    if (width === "half") return "col-span-3";
    if (width === "third") return "col-span-2";
    return "col-span-6 lg:col-span-3"; // default dynamic half-width
  };

  // ── C3 · THE GUARDRAIL ─────────────────────────────────────────────────────
  // The LLM's summary may only contain numbers that appear in the widget data it was built
  // from. narrate() validates every numeral against that payload and substitutes a safe
  // template if the model invented one. This is the rule the prototype called "the difference
  // between a trustworthy analytics copilot and a liability".
  const groundedSummary = response.summary
    ? narrate(response.summary, response.widgets ?? [])
    : "";
  const summaryWasRejected = Boolean(response.summary) && groundedSummary !== response.summary;

  return (
    <div className="space-y-6 animate-fade-in text-left">

      {/* Bullet Points insights summary */}
      {groundedSummary && (
        <div className="bg-gradient-to-r from-purple-50 via-indigo-50/40 to-white border border-purple-200/80 rounded-xl p-5 shadow-md shadow-purple-100/50 space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-purple-100/60">
            <div className="w-6 h-6 rounded-lg bg-purple-100/80 border border-purple-200 text-purple-700 flex items-center justify-center shrink-0">
              <Sparkles size={11} className="text-purple-700" />
            </div>
            <span className="text-[10px] font-mono text-purple-700 font-bold tracking-wider">AI ANALYST KEY FINDINGS</span>
          </div>
          {summaryWasRejected && (
            <div className="flex items-start gap-2 text-[11px] text-[#8a4a1d] bg-[var(--oo-warning)]/10 border border-[var(--oo-warning)]/25 rounded-md px-3 py-2">
              <AlertTriangle size={11} className="shrink-0 mt-0.5 text-[var(--oo-warning)]" />
              <span>
                The model's summary contained figures that aren't in the retrieved data, so it was
                withheld. The widgets below are computed from the dataset and remain accurate.
              </span>
            </div>
          )}
          <div className="text-xs text-slate-800 space-y-2 leading-relaxed font-medium">
            {groundedSummary.split("\n").map((line, idx) => {
              const cleaned = line.replace(/^\*\s*/, "").replace(/^\* \*\*/, "**");
              if (!cleaned.trim()) return null;

              const boldMatch = cleaned.match(/^\*\*(.*?)\*\*(.*)/);
              if (boldMatch) {
                return (
                  <div key={idx} className="flex gap-2 items-start">
                    <span className="text-purple-500 font-bold mt-0.5">•</span>
                    <span>
                      <strong>{boldMatch[1]}</strong>
                      {boldMatch[2]}
                    </span>
                  </div>
                );
              }
              return (
                <div key={idx} className="flex gap-2 items-start">
                  <span className="text-purple-500 font-bold mt-0.5">•</span>
                  <span>{cleaned}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Grid of Dynamic Widgets */}
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-5">
        {response.widgets?.map((widget, wIdx) => {
          if (widget.type === "metrics") {
            return (
              <div key={wIdx} className="col-span-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
                {widget.metricsList?.map((metric, idx) => (
                  <StatTile
                    key={idx}
                    label={metric.label}
                    value={metric.value}
                    sub={metric.sub}
                    type={inferStatType(metric)}
                    info={`${metric.label} — computed from the retrieved dataset rows for this query.`}
                    delta={
                      metric.trend && metric.trendDirection && metric.trendDirection !== "neutral"
                        ? {
                            value: metric.trend,
                            direction: metric.trendDirection,
                            goodDirection: inferGoodDirection(metric.label),
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            );
          }

          if (widget.type === "chart") {
            return (
              <div key={wIdx} className={`bg-card border border-border rounded-xl p-5 shadow-sm space-y-4 flex flex-col ${getColSpan(widget.width)}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/40 pb-3">
                  <div>
                    <div className="text-xs font-bold text-slate-800 uppercase tracking-wider">{widget.title}</div>
                    {widget.caption && (
                      <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{widget.caption}</div>
                    )}
                    {widget.xAxisKey && widget.seriesKeys && (
                      <div className="text-[9px] text-muted-foreground font-mono mt-0.5">X-Axis: {widget.xAxisKey} | Y-Axis: {widget.seriesKeys.join(", ")}</div>
                    )}
                  </div>

                  {/* Chart Type Toggle Toolbar */}
                  {widget.chartType && (
                    <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 w-fit shrink-0">
                      {(["bar", "line", "area", "radar", "pie"] as const).map(type => (
                        <button
                          key={type}
                          onClick={() => {
                            setResponse(prev => {
                              if (!prev) return null;
                              const updatedWidgets = [...prev.widgets];
                              updatedWidgets[wIdx] = { ...updatedWidgets[wIdx], chartType: type };
                              return { ...prev, widgets: updatedWidgets };
                            });
                          }}
                          className={`text-[8px] font-bold px-2 py-0.5 rounded transition-all uppercase font-mono ${
                            widget.chartType === type
                              ? "bg-white text-purple-700 shadow-xs border border-purple-100/50"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="h-[260px] w-full mt-2">
                  <WidgetChart widget={widget} />
                </div>
              </div>
            );
          }

          if (widget.type === "table") {
            return (
              <div key={wIdx} className={`bg-card border border-border rounded-xl p-5 shadow-sm space-y-4 flex flex-col ${getColSpan(widget.width)}`}>
                <div className="border-b border-border/40 pb-2">
                  <div className="text-xs font-bold text-slate-800 uppercase tracking-wider">{widget.title}</div>
                  {widget.caption && (
                    <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug normal-case">{widget.caption}</div>
                  )}
                </div>
                <div className="overflow-x-auto max-h-[265px] scrollbar-thin mt-2">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-border bg-slate-50 text-[9px] text-muted-foreground uppercase font-mono">
                        {widget.tableHeaders?.map(h => (
                          <th key={h} className="p-2.5 font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {widget.data?.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-slate-50/50 transition-colors">
                          {widget.tableHeaders?.map(h => (
                            <td key={h} className="p-2.5 font-mono text-[10px] text-slate-700">{row[h] !== undefined && row[h] !== null ? row[h].toString() : "-"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          }

          if (widget.type === "text") {
            return (
              <div key={wIdx} className={`bg-card border border-border rounded-xl p-5 shadow-sm space-y-3 flex flex-col ${getColSpan(widget.width)}`}>
                <div className="border-b border-border/40 pb-2">
                  <div className="text-xs font-bold text-slate-800 uppercase tracking-wider">{widget.title}</div>
                </div>
                <div className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap mt-2">{widget.content}</div>
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}

export default AIDashboardView;
