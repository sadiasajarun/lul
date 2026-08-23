// Canonical dashboard widget / response types shared by the render path (MessageWidgets, WidgetChart,
// ChatMsg, exports). Previously these lived in the now-deleted utils/openAIHelper engine; they live
// here so the live path no longer depends on dead code. The agent's interpret.ts produces structurally
// compatible objects (cast in App.buildPipelineMessage).

export interface DashboardWidget {
  type: "chart" | "metrics" | "table" | "text";
  title: string;
  /** One line under the title saying, in words, what is actually plotted / listed. */
  caption?: string;
  width?: "full" | "half" | "third";

  // chart
  chartType?: "bar" | "line" | "area" | "pie" | "radar" | "scatter";
  xAxisKey?: string;
  seriesKeys?: string[];

  // metrics
  metricsList?: {
    label: string;
    value: string;
    sub: string;
    trend?: string;
    trendDirection?: "up" | "down" | "neutral";
  }[];

  // table
  tableHeaders?: string[];

  // generic rows (chart points / table rows) — loose by design for the renderer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any[];

  // text card
  content?: string;
}

export interface DynamicDashboardResponse {
  summary: string;
  widgets: DashboardWidget[];
}
