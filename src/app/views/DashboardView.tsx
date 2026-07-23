import "../../styles/dashboard.css";
import { useState } from "react";
import { FilterPanel, type DashFilter } from "./FilterPanel";
import { OverviewView } from "./OverviewView";
import { StudentsView } from "./StudentsView";
import { LearningView } from "./LearningView";
import { CentersView } from "./CentersView";
import { EquityView } from "./EquityView";

/**
 * DASHBOARD — a single Overview page (no tabs) with all the key information: the Overview zones on
 * top, then Students / Learning / Centres / Equity sections stacked. `onAsk` lets card CTAs open the
 * Copilot. The filter panel (toggled from the context strip) re-scopes the Overview.
 */
function SectionHead({ label }: { label: string }) {
  return (
    <div className="section-head"><span className="section-head__line" /><h2>{label}</h2><span className="section-head__line" /></div>
  );
}

export function DashboardView({ onAsk }: { onAsk: (q: string) => void }) {
  const [filter, setFilter] = useState<DashFilter>({});
  return (
    <div className="oo-dash">
      {/* Views + natural-language filter + quick-analysis prompts — kept fixed (sticky) at the top. */}
      <FilterPanel value={filter} onChange={setFilter} onReset={() => setFilter({})} onAsk={onAsk} />

      <OverviewView onAsk={onAsk} filter={filter} onClearFilter={() => setFilter({})} />

      <SectionHead label="Students" />
      <StudentsView />

      <SectionHead label="Learning" />
      <LearningView />

      <SectionHead label="Centres & Field" />
      <CentersView />

      <SectionHead label="Equity" />
      <EquityView />
    </div>
  );
}

export default DashboardView;
