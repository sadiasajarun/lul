import { useState } from "react";
import { Wand2, Sparkles, TrendingDown, GitCompare, MapPin, CalendarCheck, Scale } from "lucide-react";

/** Dashboard filter — only the dimensions the real data supports are functional. */
export interface DashFilter { program?: string; division?: string; sex?: string }

// The real divisions present in the data (used only by the smart-filter keyword parser).
const DIVISIONS = ["Dhaka", "Mymensingh", "Chattogram", "Sylhet", "Rangpur"];

/** Quick-analysis prompts — click to ask the Copilot (replaced the old dropdown grid). */
const QUICK_PROMPTS = [
  { icon: TrendingDown, q: "Why are students dropping out?" },
  { icon: GitCompare, q: "Compare the three programmes" },
  { icon: MapPin, q: "Which centres need support?" },
  { icon: CalendarCheck, q: "Show attendance month by month" },
  { icon: Scale, q: "Where is equity weakest?" },
] as const;

/** Keyword parse — the "AI fill" of the smart filter (mirrors the prototype's parseFilter). */
export function parseSmart(q: string): DashFilter {
  q = q.toLowerCase();
  const f: DashFilter = {};
  if (/abal/.test(q)) f.program = "ABAL";
  else if (/catch\s?up/.test(q)) f.program = "Catchup";
  else if (/innovation/.test(q)) f.program = "Innovation";
  DIVISIONS.forEach((d) => { if (q.includes(d.toLowerCase())) f.division = d; });
  if (/girl|female/.test(q)) f.sex = "Girls";
  else if (/boy|male/.test(q)) f.sex = "Boys";
  return f;
}

export function FilterPanel({
  value, onChange, onReset, onAsk,
}: {
  value: DashFilter;
  onChange: (f: DashFilter) => void;
  onReset: () => void;
  onAsk: (q: string) => void;
}) {
  const [smart, setSmart] = useState("");
  const active = (Object.entries(value) as [keyof DashFilter, string | undefined][]).filter(([, v]) => v);
  const runSmart = () => {
    const f = parseSmart(smart);
    if (Object.keys(f).length) onChange({ ...value, ...f });
    setSmart("");
  };

  return (
    <div className="filterpanel filterpanel--sticky">
      <div className="savedrow">
        <span className="t">Your views</span>
        <button className={`sv ${active.length === 0 ? "on" : ""}`} onClick={onReset}>★ All Bangladesh</button>
        <button className="sv" onClick={() => onChange({ program: "Catchup", division: "Dhaka", sex: "Girls" })}>Dhaka · Girls · Catchup</button>
        {active.length > 0 && (
          <div className="fchips">
            {active.map(([k, v]) => (
              <span key={k} className="fchip">{v}<button onClick={() => onChange({ ...value, [k]: undefined })} aria-label="remove">×</button></span>
            ))}
          </div>
        )}
      </div>

      <div className="smartfilter">
        <Wand2 size={16} />
        <input
          value={smart}
          onChange={(e) => setSmart(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSmart()}
          placeholder="Describe what you want to see — e.g. “Catchup girls in Dhaka”…"
        />
        <button className="go" onClick={runSmart}><Wand2 size={13} /> AI fill</button>
      </div>

      <div className="quickprompts">
        <span className="qp-label"><Sparkles size={12} /> Quick analysis</span>
        {QUICK_PROMPTS.map(({ icon: Icon, q }) => (
          <button key={q} className="qp" onClick={() => onAsk(q)}><Icon size={13} />{q}</button>
        ))}
      </div>
    </div>
  );
}

export default FilterPanel;
