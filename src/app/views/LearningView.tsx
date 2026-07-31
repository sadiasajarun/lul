import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { narrate } from "../utils/insights";
import { Card, ChartTooltip, Insight, DataNote } from "./dashShared";
import { getDataSource } from "../lib/db";
import { loadLearning, type LearningData } from "../lib/db/learning-query";

/**
 * LEARNING section — average exam marks by subject × programme and weakest subject per programme,
 * computed from the REAL marks (v_marks) via the engine. Marks are coverage-limited (~30% of
 * learners have any mark) and Life Skills is largely unassessed — both flagged honestly.
 */

const compact = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v));

export function LearningView() {
  const [d, setD] = useState<LearningData | null>(null);
  useEffect(() => {
    let cancelled = false;
    const ds = getDataSource();
    loadLearning((sql) => ds.query(sql)).then((r) => { if (!cancelled) setD(r); }).catch((e) => console.error("learning load failed", e));
    return () => { cancelled = true; };
  }, []);

  if (!d) return <div style={{ padding: 24, color: "var(--oo-muted)", fontSize: 13 }}>Loading learning…</div>;

  const { subjectData, weakestByProgramme, coveragePct } = d;

  // Network-weakest subject (by 3-programme average).
  let weakSubject = subjectData[0]?.subject ?? "—";
  let weakAvg = Infinity;
  for (const sd of subjectData) {
    const avg = (sd.ABAL + sd.Catchup + sd.Innovation) / 3;
    if (avg > 0 && avg < weakAvg) { weakAvg = avg; weakSubject = sd.subject; }
  }
  const bangla = subjectData.find((s) => s.subject === "Bangla");
  const math = subjectData.find((s) => s.subject === "Mathematics");
  const insight = narrate(
    `On the real marks, Catchup leads on Bangla (${bangla?.Catchup ?? 0}) and Mathematics (${math?.Catchup ?? 0}). ` +
      `The lowest-scoring subject network-wide is ${weakSubject} — though its score is depressed by low assessment coverage.`,
    { rows: subjectData }
  );

  return (
    <>
      <Card title="Average marks by subject" sub={`${subjectData.length} subjects · 3 programmes · marks coverage ${coveragePct}%`}>
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
          Averages are over recorded marks only (~{coveragePct}% of learners have any mark). <b>Life Skills</b> is ~84%
          unassessed, so its low bar is a coverage artefact, not necessarily weak performance.
        </DataNote>
      </Card>

      <div className="row-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "stretch" }}>
        <Card title="Weakest subject to target" sub="Lowest-scoring subject per programme">
          <div style={{ paddingTop: 2 }}>
            {weakestByProgramme.map((w) => (
              <div className="divrow" key={w.programme}>
                <span className="nm">{w.programme}</span>
                <span style={{ flex: 1, fontSize: 13, color: "var(--oo-muted)" }}>
                  Weakest: <b style={{ color: "var(--oo-heading)" }}>{w.subject}</b>
                </span>
                <span className="val tnum">{w.value}</span>
              </div>
            ))}
          </div>
          <Insight text={`Each programme scores lowest in ${weakSubject} network-wide — but read the weakest subject alongside its coverage before concentrating teaching support.`} />
        </Card>

        <Card title="What to read with care" sub="Coverage limits on the marks data">
          <div className="dq">
            <div className="dq-item">
              <div className="band" style={{ background: "var(--oo-info)" }} />
              <p>Only <b>~{coveragePct}%</b> of learners have any recorded mark, so subject averages describe the assessed minority, not the whole cohort.</p>
              <span className="st" style={{ background: "color-mix(in srgb, var(--oo-info) 14%, transparent)", color: "var(--oo-info)" }}>coverage</span>
            </div>
            <div className="dq-item">
              <div className="band" style={{ background: "var(--oo-info)" }} />
              <p>Cycle marks (C1–C5) are barely recorded, so averages mostly reflect the baseline rather than progress over time.</p>
              <span className="st" style={{ background: "color-mix(in srgb, var(--oo-info) 14%, transparent)", color: "var(--oo-info)" }}>coverage</span>
            </div>
          </div>
          <DataNote>Ask the AI Copilot for any subject/programme/gender cut — it computes these live from the real marks (e.g. "average Bangla for girls in ABAL").</DataNote>
        </Card>
      </div>
    </>
  );
}

export default LearningView;
