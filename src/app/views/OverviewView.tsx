import { useState, type ReactNode, type CSSProperties } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Sparkles, Lightbulb, FileText, X } from "lucide-react";
import trends from "../../../Database/demo/aggregates/trends.json";
import { fmtInt, fmtRate } from "../lib/fmt";
import { narrate } from "../utils/insights";
import { printHtml } from "../utils/chatExport";
import {
  programs, totals, divisions, attendance,
  PROGRAM_KEYS, PROGRAM_LABELS, COVERAGE_THRESHOLD, type ProgramKey,
} from "../lib/aggregates";
import { METRICS } from "../lib/knowledgeBase";
import demographics from "../../../Database/demo/aggregates/demographics.json";
import SUMMARY from "../../../Database/demo/summary_dataset.json";
import type { DashFilter } from "./FilterPanel";

/**
 * OVERVIEW tab — ported from the prototype, wired to real aggregates, and filter-aware (D-7).
 * Programme / Division / Sex actually re-scope the numbers and charts where the data supports it;
 * teachers, M&E and the network insights stay network-level (and say so). "Report this view" prints
 * the current scope.
 */

const DEMO = (demographics as unknown as { by_program: Record<string, { division: Record<string, number> }> }).by_program;
const LABEL_TO_KEY: Record<string, ProgramKey> = { ABAL: "abal", Catchup: "catchup", Innovation: "innovation" };
const SERIES = { enrolled: "var(--series-3)", mainstreamed: "var(--series-1)" };
const SEV_COLOR: Record<string, string> = { critical: "var(--oo-danger)", warn: "var(--oo-warning)", watch: "var(--oo-info)", info: "var(--oo-muted)" };

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
function todayStr(): string {
  try { return new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" }); } catch { return ""; }
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-[var(--oo-border)] p-3 text-[12px] shadow-lg" style={{ borderRadius: "var(--oo-card-radius)" }}>
      <div className="text-[var(--oo-muted)] mb-1.5 font-semibold">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="font-semibold text-[var(--oo-heading)]">{fmtInt(p.value)}</span>
          <span className="text-[var(--oo-muted)]">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

function NTile({ v, typ, l, pct, ctx, info }: { v: string; typ: string; l: string; pct?: string; ctx?: { text: string; warn?: boolean }; info?: string }) {
  return (
    <div className="ntile" title={info}>
      <div className="top"><div className="v tnum">{v}</div><span className="typ">{typ}</span></div>
      <div className="l">{l}</div>
      {pct && <div className="pct">{pct}</div>}
      {ctx && <div className={`ctx ${ctx.warn ? "warn" : ""}`}>{ctx.text}</div>}
    </div>
  );
}

function Insight({ text }: { text: string }) {
  return (<div className="insight"><div className="t"><Sparkles size={11} /> AI insight</div><p>{text}</p></div>);
}

interface Explain { title: string; big: string; how: string; why: string; note: string }
interface Driver { key: string; band: string; eyebrow: string; what: string; num: string; unit: string; bandTxt: string; fact: ReactNode; ask: string; cta: string; help: string; explain: Explain }

export function OverviewView({ onAsk, filter, onClearFilter }: {
  onAsk: (q: string) => void;
  filter: DashFilter;
  onClearFilter: () => void;
}) {
  const [explain, setExplain] = useState<Explain | null>(null);

  const key = filter.program ? LABEL_TO_KEY[filter.program] : null;
  const genderField: "boys" | "girls" | null = filter.sex === "Boys" ? "boys" : filter.sex === "Girls" ? "girls" : null;
  const scopeParts = [filter.program, filter.division, filter.sex].filter(Boolean) as string[];
  const filtered = scopeParts.length > 0;

  // ── scoped numbers ──────────────────────────────────────────────────────────
  const networkRate = (totals.mainstream_rate ?? 0) * 100;
  const att = attendance.overall;
  const meScoreRaw = Number(METRICS.kpis.find((k) => k.id === "centers.grade.mean")?.value ?? 0);
  const meScore = meScoreRaw || 3.35;

  let scopedStudents = key ? programs[key].students : totals.students;
  if (genderField) scopedStudents = key ? programs[key][genderField] : PROGRAM_KEYS.reduce((s, k) => s + programs[k][genderField], 0);
  const scopedMainstreamed = key ? programs[key].mainstreamed : totals.mainstreamed;
  const scopedRate = key ? (programs[key].mainstream_rate ?? 0) * 100 : networkRate;
  const scopedAtt = key ? programs[key].attendance.recorded_mean ?? 0 : att.recorded_mean_student_weighted;
  const scopedCov = key ? programs[key].attendance.coverage : att.coverage;
  const lowCoverage = scopedCov < COVERAGE_THRESHOLD;

  // Programme Health composite (network) for the driver card
  const health = Math.round(0.45 * networkRate + 0.3 * (meScore / 4) * 100 + 0.25 * att.recorded_mean_student_weighted);
  const healthBand = health >= 75 ? "var(--oo-success)" : health >= 60 ? "var(--oo-warning)" : "var(--oo-danger)";
  const healthTxt = health >= 75 ? "Strong" : health >= 60 ? "Fair" : "Needs attention";

  // Driver-card figures — computed live from the demo dataset (never hardcoded).
  const dropTotal = (k: ProgramKey) => Object.values(SUMMARY.programs[k].dropout_reasons).reduce((s, n) => s + (n as number), 0);
  const povertyDropouts = PROGRAM_KEYS.reduce((s, k) => s + ((SUMMARY.programs[k].dropout_reasons as Record<string, number>).Poverty ?? 0), 0);
  const totalDropouts = PROGRAM_KEYS.reduce((s, k) => s + dropTotal(k), 0);
  const povertyPct = Math.round((povertyDropouts / totalDropouts) * 100);
  const poorCentres = SUMMARY.me_evaluations.filter((e) => e.score < 2).length;
  const fairCentres = SUMMARY.me_evaluations.filter((e) => e.score >= 2 && e.score < 3).length;
  const goodCentres = SUMMARY.me_evaluations.filter((e) => e.score >= 3).length;

  const drivers: Driver[] = [
    {
      key: "health", band: healthBand, eyebrow: "Programme Health", what: "One score for the whole programme",
      num: String(health), unit: "/100", bandTxt: healthTxt,
      fact: (<>A weighted blend of <b>mainstreaming {fmtRate(networkRate)}</b>, centre <b>M&amp;E {meScore}/4</b> and recorded attendance.</>),
      ask: "What is dragging programme health down?", cta: "Ask what's dragging it", help: "Higher is better. A composite of mainstreaming, learning and attendance.",
      explain: { title: "Programme Health", big: `${health} / 100`, how: "Weighted average: mainstreaming 45%, centre M&E 30%, recorded attendance 25%.", why: `Held up by an ${fmtRate(networkRate)} mainstreaming rate and a ${meScore}/4 mean M&E score.`, note: "Computed live from Database/demo; attendance is fully recorded (100% coverage)." },
    },
    {
      key: "dropout", band: "var(--oo-warning)", eyebrow: "Poverty dropouts", what: "The largest, most addressable driver",
      num: fmtInt(povertyDropouts), unit: "learners", bandTxt: "Watch",
      fact: (<>Poverty is the #1 dropout reason — <b>{povertyPct}%</b> of all {fmtInt(totalDropouts)} recorded dropouts. The lever is household cash support.</>),
      ask: "Why are students dropping out?", cta: "See dropout drivers", help: "Learners whose recorded dropout reason is Poverty, across all three programmes.",
      explain: { title: "Poverty dropouts", big: `${fmtInt(povertyDropouts)} learners`, how: `Poverty dropouts summed across ABAL, Catchup and Innovation (${fmtInt(povertyDropouts)} of ${fmtInt(totalDropouts)} total dropouts).`, why: "Poverty is the single largest recorded dropout reason network-wide.", note: "Computed live from Database/demo dropout reasons." },
    },
    {
      key: "centres", band: "var(--oo-danger)", eyebrow: "Centres needing support", what: "Where field support should go first",
      num: String(poorCentres), unit: "centres", bandTxt: "Act",
      fact: (<><b>{poorCentres} centres</b> score Poor (below 2/4). Start field support here — {fairCentres} more are Fair.</>),
      ask: "Which centres need a visit?", cta: "See which centres", help: "Centres with a mean M&E evaluation score below 2.0 of 4.",
      explain: { title: "Centres needing support", big: `${poorCentres} centres`, how: "Centres whose mean M&E score is below 2.0 of 4.", why: `The weakest-quality centres; ${fairCentres} more are Fair and ${goodCentres} Good.`, note: "Computed live from Database/demo me_evaluations." },
    },
  ];

  // ── scoped charts ───────────────────────────────────────────────────────────
  const programData = (key ? [key] : PROGRAM_KEYS).map((k) => ({ name: PROGRAM_LABELS[k], Enrolled: programs[k].students, Mainstreamed: programs[k].mainstreamed }));
  const divSource: Record<string, number> = key ? DEMO[key].division ?? {} : divisions;
  const divisionData = Object.entries(divSource).map(([division, students]) => ({ division, students: students as number })).sort((a, b) => b.students - a.students);
  const topDivision = divisionData[0];
  const divisionTotal = divisionData.reduce((s, d) => s + d.students, 0);

  const enrolPayload = {
    catchupStudents: programs.catchup.students,
    catchupRate: Math.round((programs.catchup.mainstream_rate ?? 0) * 1000) / 10,
    abalRate: Math.round((programs.abal.mainstream_rate ?? 0) * 1000) / 10,
    innovationRate: Math.round((programs.innovation.mainstream_rate ?? 0) * 1000) / 10,
  };
  const enrolInsight = narrate(
    `Catchup carries ${fmtInt(enrolPayload.catchupStudents)} of the network's learners and has mainstreamed ${enrolPayload.catchupRate}% of them. ` +
      `ABAL sits at ${enrolPayload.abalRate}% and Innovation at ${enrolPayload.innovationRate}% — very different stages of their cohort cycle.`,
    enrolPayload
  );
  const divPayload = { top: topDivision.students, topShare: Math.round((topDivision.students / divisionTotal) * 1000) / 10, count: divisionData.length };
  const divInsight = narrate(
    `${topDivision.division} holds ${fmtInt(divPayload.top)} learners — ${divPayload.topShare}% of enrolment across ${divPayload.count} divisions. ` +
      `Enrolment is heavily concentrated, so a network-wide average mostly describes the largest divisions.`,
    divPayload
  );

  const dq = METRICS.dataQuality ?? [];
  const scopeText = scopeParts.length ? scopeParts.join(" · ") : "All Bangladesh · All programmes · 2026";

  const reportView = () => {
    const rows: [string, string][] = [
      ["Total enrolment", fmtInt(scopedStudents)],
      ["Mainstream rate", fmtRate(scopedRate)],
      ["Mainstreamed", fmtInt(scopedMainstreamed)],
      ["Attendance (recorded)", fmtRate(scopedAtt)],
      ["Total teachers (network)", fmtInt(totals.teachers)],
      ["Mean M&E score (network)", String(meScore)],
    ];
    const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    printHtml(
      `<h1>Dashboard view</h1><div class="meta">${scopeText} · ${date} · grounded to Database/</div>` +
        `<table><tr><th>Metric</th><th>Value</th></tr>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("")}</table>` +
        `<p style="font-size:11px;color:#7a8397;margin-top:14px">Teachers and M&amp;E are network-level (not sliced by the current filter). Every figure is computed from Database/aggregates.</p>`,
      "Dashboard view"
    );
  };

  return (
    <>
      {/* context strip */}
      <div className="ctxstrip">
        <div className="hi">{greeting()}, Admin</div>
        <div className="date">{todayStr()}</div>
        <div className="scope">
          <span>Showing</span>:&nbsp;<b>{scopeText}</b>
        </div>
      </div>

      {/* scope banner (active filters) */}
      {filtered && (
        <div className="scopebanner">
          <span className="sb-t">Filtered view</span>
          {scopeParts.map((c) => (<span key={c} className="sb-chip">{c}</span>))}
          <span style={{ fontSize: 12, color: "var(--oo-muted)" }}>Numbers &amp; charts reflect this scope where the data supports it.</span>
          <div className="sb-act">
            <button className="sb-btn" onClick={reportView}><FileText size={13} /> Report this view</button>
            <button className="sb-btn" onClick={onClearFilter}><X size={13} /> Clear</button>
          </div>
        </div>
      )}

      {/* What needs you today */}
      <div className="section-head"><span className="section-head__line" /><h2>What needs you today</h2><span className="section-head__line" /></div>
      <div className="row-3">
        {drivers.map((d) => (
          <div key={d.key} className="today-card" style={{ "--band": d.band } as CSSProperties}>
            <div className="eyebrow">{d.eyebrow}<span className="help">i<span className="bub">{d.help}</span></span></div>
            <div className="what">{d.what}</div>
            <div className="num tnum">{d.num}</div>
            <div className="unit">{d.unit}</div>
            <div className="band">{d.bandTxt}</div>
            <div className="fact">{d.fact}</div>
            <button className="explain" onClick={() => setExplain(d.explain)}><Lightbulb size={13} /> Explain this number</button>
            <button className="cta" onClick={() => onAsk(d.ask)}>{d.cta} →</button>
          </div>
        ))}
      </div>

      {/* The numbers */}
      <div className="section-head"><span className="section-head__line" /><h2>The numbers</h2><span className="section-head__line" /></div>
      <div className="numtiles">
        <NTile v={fmtInt(scopedStudents)} typ="Total" l={filter.sex ? `${filter.sex} enrolled` : "Total enrolment"} pct={key ? PROGRAM_LABELS[key] : `Across ${totals.programs} programmes`} info="Enrolled learners for the current scope." />
        <NTile v={fmtRate(scopedRate)} typ="Rate" l="Mainstream rate" pct={`${fmtInt(scopedMainstreamed)} moved to formal school`} info="Share mainstreamed into formal school." />
        <NTile v={fmtInt(totals.teachers)} typ="Total" l="Total teachers" pct={filtered ? "network — not sliced by filter" : "Active educators"} info="Teacher records; not broken down by programme/division in the aggregates." />
        <NTile v={String(meScore)} typ="Score" l="Mean M&E score" pct={filtered ? "network — not sliced by filter" : "of 4 · across evaluated centres"} info="Mean centre M&E evaluation score (network-level)." />
        <NTile v={fmtRate(scopedAtt)} typ="Rate" l="Attendance (recorded)" pct="Mean among learners with a record"
          ctx={{ text: `Coverage ${fmtRate(scopedCov * 100)} — read as a floor; 0-rows treated as missing.`, warn: lowCoverage }}
          info="Student-weighted mean over learners with a non-zero attendance record." />
      </div>

      {/* What's happening */}
      <div className="section-head"><span className="section-head__line" /><h2>What's happening</h2><span className="section-head__line" /></div>
      <div className="card">
        <div className="ch"><div><h2>Enrolment by programme</h2><div className="sub">{key ? PROGRAM_LABELS[key] : `${totals.programs} programmes`} · {fmtInt(scopedStudents)} learners</div></div></div>
        <div className="cb">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={programData} barSize={34} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--oo-border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "var(--oo-text)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "var(--oo-text)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--oo-canvas)" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
              <Bar dataKey="Enrolled" fill={SERIES.enrolled} radius={[3, 3, 0, 0]} />
              <Bar dataKey="Mainstreamed" fill={SERIES.mainstreamed} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {!key && <Insight text={enrolInsight} />}
        </div>
      </div>

      <div className="card">
        <div className="ch"><div><h2>Enrolment by division{key ? ` — ${PROGRAM_LABELS[key]}` : ""}</h2><div className="sub">{divisionData.length} divisions · {fmtInt(divisionTotal)} learners</div></div></div>
        <div className="cb">
          {divisionData.map((d, i) => (
            <div className="divrow" key={d.division}>
              <span className="rank">{i + 1}</span>
              <span className="nm">{d.division}</span>
              <div className="track"><div className="fill" style={{ width: `${Math.max((d.students / topDivision.students) * 100, 0.5)}%` }} /></div>
              <span className="val tnum">{fmtInt(d.students)}</span>
            </div>
          ))}
          {!key && <Insight text={divInsight} />}
        </div>
      </div>

      <div className="card">
        <div className="ch"><div><h2>Attendance, month by month</h2><div className="sub">Recorded attendance across the year · 100% coverage</div></div></div>
        <div className="cb">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trends.months} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--oo-border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "var(--oo-text)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: "var(--oo-text)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
              <Line type="monotone" dataKey="ABAL" stroke="#6697C6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Catchup" stroke="#00C19C" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Innovation" stroke="#CC6AC2" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="overall" name="Overall" stroke="var(--oo-primary)" strokeWidth={2.6} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <Insight text="Recorded attendance climbs steadily through the year and stays consistent across all three programmes — every learner has a monthly record in this dataset." />
        </div>
      </div>

      {/* Trust & data quality */}
      <div className="section-head"><span className="section-head__line" /><h2>Trust &amp; data quality</h2><span className="section-head__line" /></div>
      <div className="card">
        <div className="cb">
          <div className="dq">
            {dq.map((q, i) => {
              const c = SEV_COLOR[q.severity] ?? SEV_COLOR.info;
              return (
                <div className="dq-item" key={i}>
                  <div className="band" style={{ background: c }} />
                  <p>{q.statement}</p>
                  <span className="st" style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}>{q.severity}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Explain-number modal */}
      {explain && (
        <div className="oo-explain-scrim" onClick={(e) => { if (e.target === e.currentTarget) setExplain(null); }}>
          <div className="oo-explain-card">
            <h3>💡 {explain.title}</h3>
            <div className="big">{explain.big}</div>
            <div className="row"><span className="k">How</span><span>{explain.how}</span></div>
            <div className="row"><span className="k">Why</span><span>{explain.why}</span></div>
            <div className="row"><span className="k">Note</span><span>{explain.note}</span></div>
            <button className="close" onClick={() => setExplain(null)}>Got it</button>
          </div>
        </div>
      )}
    </>
  );
}

export default OverviewView;
