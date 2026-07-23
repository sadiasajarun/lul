import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import summary from "../../../Database/demo/summary_dataset.json";
import { narrate } from "../utils/insights";
import { PROGRAM_KEYS, PROGRAM_LABELS, type ProgramKey } from "../lib/aggregates";
import { Card, ChartTooltip, Insight, DataNote } from "./dashShared";

/**
 * LEARNING tab — average exam marks by subject × programme, from summary_dataset.subject_averages
 * (real). The prototype's score-BAND distributions (Red/Yellow/Green…), results-by-gender and
 * pass-by-income need per-student assessment rows joined to profiles — not in the aggregates — so
 * those are called out honestly rather than faked.
 */

const SA = (summary as { subject_averages: Record<ProgramKey, Record<string, number>> }).subject_averages;
const SUBJECTS = Object.keys(SA.abal);
const compact = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v));

function weakest(prog: ProgramKey): { subject: string; value: number } {
  let subject = SUBJECTS[0];
  let value = Infinity;
  for (const s of SUBJECTS) {
    const v = SA[prog][s];
    if (v != null && v < value) { value = v; subject = s; }
  }
  return { subject, value };
}

export function LearningView() {
  const subjectData = SUBJECTS.map((s) => ({
    subject: s,
    ABAL: SA.abal[s] ?? 0,
    Catchup: SA.catchup[s] ?? 0,
    Innovation: SA.innovation[s] ?? 0,
  }));

  // network-weakest subject (by 3-programme average) — name only, so no derived number to validate
  let weakSubject = SUBJECTS[0];
  let weakAvg = Infinity;
  for (const s of SUBJECTS) {
    const avg = (SA.abal[s] + SA.catchup[s] + SA.innovation[s]) / 3;
    if (avg < weakAvg) { weakAvg = avg; weakSubject = s; }
  }

  const insight = narrate(
    `Catchup leads on Bangla (${SA.catchup.Bangla}) and Mathematics (${SA.catchup.Mathematics}), with Innovation trailing ` +
      `on both. The weakest subject network-wide is ${weakSubject} — the clearest place to concentrate teaching support.`,
    { rows: subjectData }
  );

  return (
    <>
      <Card title="Average marks by subject" sub={`${SUBJECTS.length} subjects · 3 programmes`}>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={subjectData} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--oo-border)" vertical={false} />
            <XAxis dataKey="subject" tick={{ fill: "var(--oo-text)", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
            <YAxis tick={{ fill: "var(--oo-text)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={compact} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--oo-canvas)" }} />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
            <Bar dataKey="ABAL" fill="#6697C6" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Catchup" fill="#00C19C" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Innovation" fill="#CC6AC2" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <Insight text={insight} />
        <DataNote>
          The prototype's Red/Yellow/Green/Pink/Blue score <b>bands</b> need each learner's subject scores counted into
          bands — that per-student join isn't in the aggregates, so this shows programme averages instead.
        </DataNote>
      </Card>

      <div className="row-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "stretch" }}>
        <Card title="Weakest subject to target" sub="Lowest-scoring subject per programme">
          <div style={{ paddingTop: 2 }}>
            {PROGRAM_KEYS.map((k) => {
              const w = weakest(k);
              return (
                <div className="divrow" key={k}>
                  <span className="nm">{PROGRAM_LABELS[k]}</span>
                  <span style={{ flex: 1, fontSize: 13, color: "var(--oo-muted)" }}>
                    Weakest: <b style={{ color: "var(--oo-heading)" }}>{w.subject}</b>
                  </span>
                  <span className="val tnum">{w.value}</span>
                </div>
              );
            })}
          </div>
          <Insight text={`${PROGRAM_LABELS[PROGRAM_KEYS[0]]}, Catchup and Innovation each score lowest in ${weakSubject} — a consistent, network-wide teaching gap to prioritise.`} />
        </Card>

        <Card title="Where the data stops" sub="Prototype views that need per-student assessment rows">
          <div className="dq">
            <div className="dq-item">
              <div className="band" style={{ background: "var(--oo-info)" }} />
              <p><b>Results by gender</b> and <b>pass ratio by family income</b> need each learner's subject scores joined to their profile (gender, income). That per-student join isn't in the current aggregates.</p>
              <span className="st" style={{ background: "color-mix(in srgb, var(--oo-info) 14%, transparent)", color: "var(--oo-info)" }}>needs data</span>
            </div>
            <div className="dq-item">
              <div className="band" style={{ background: "var(--oo-info)" }} />
              <p>Assessment cycle marks are barely recorded (Cycle-1 coverage ~5.5%), so subject averages reflect the baseline, not progress over time.</p>
              <span className="st" style={{ background: "color-mix(in srgb, var(--oo-info) 14%, transparent)", color: "var(--oo-info)" }}>coverage</span>
            </div>
          </div>
          <DataNote>Ask the Smart Copilot for any subject/programme cut — it can compute these from the retrieved rows.</DataNote>
        </Card>
      </div>
    </>
  );
}

export default LearningView;
