import { useState, useEffect } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { fmtInt } from "../lib/fmt";
import { narrate } from "../utils/insights";
import { Card, ChartTooltip, Insight, DataNote } from "./dashShared";
import { getDataSource } from "../lib/db";
import { loadStudents, type StudentsData } from "../lib/db/students-query";

/**
 * STUDENTS section — wired to the REAL data via the engine (loadStudents). Mainstreamed status,
 * gender by programme, dropout reasons, and a real early-warning list (signals from actual dropout
 * reason + recorded attendance + marks; the old per-student risk_score/cash_missed were synthetic).
 */

const compact = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v));
const girlPct = (r: { Boys: number; Girls: number }) => {
  const t = r.Boys + r.Girls;
  return t ? Math.round((r.Girls / t) * 1000) / 10 : 0;
};

export function StudentsView() {
  const [d, setD] = useState<StudentsData | null>(null);
  useEffect(() => {
    let cancelled = false;
    const ds = getDataSource();
    loadStudents((sql) => ds.query(sql)).then((r) => { if (!cancelled) setD(r); }).catch((e) => console.error("students load failed", e));
    return () => { cancelled = true; };
  }, []);

  if (!d) return <div style={{ padding: 24, color: "var(--oo-muted)", fontSize: 13 }}>Loading students…</div>;

  const { total, mainstreamed, remaining, rate, risk } = d;
  const statusData = [
    { name: "Mainstreamed", value: mainstreamed, color: "var(--series-1)" },
    { name: "Not yet mainstreamed", value: remaining, color: "var(--series-3)" },
  ];
  const statusInsight = narrate(
    `${fmtInt(mainstreamed)} of ${fmtInt(total)} learners (${rate}%) have been mainstreamed into formal school. ` +
      `The remaining ${fmtInt(remaining)} are still in the programme.`,
    { mainstreamed, total, remaining, rate }
  );

  const genderData = d.genderByProgramme;
  const genderPcts = genderData.map((g) => girlPct(g));
  const genderInsight = narrate(
    `Gender balance by programme — ${genderData.map((g) => `${g.name} ${girlPct(g)}% girls`).join(", ")}. ` +
      `Girls are at or near parity across the programme.`,
    { rows: genderData, pcts: genderPcts }
  );

  const dropoutData = d.dropoutReasons;
  const totalDropouts = d.totalDropouts;
  const poverty = d.poverty;
  const povertyShare = totalDropouts ? Math.round((poverty / totalDropouts) * 1000) / 10 : 0;
  const dropoutInsight = narrate(
    `Poverty is the leading reason children leave — ${fmtInt(poverty)} learners, ${povertyShare}% of the ` +
      `${fmtInt(totalDropouts)} recorded dropouts. It outweighs every other reason combined.`,
    { poverty, totalDropouts, povertyShare, rows: dropoutData }
  );

  const flagged = risk.bands.Critical + risk.bands.High + risk.bands.Elevated;

  return (
    <>
      <div className="row-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "stretch" }}>
        <Card title="Students by status" sub={`${fmtInt(total)} learners · ${rate}% mainstreamed`}>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={54} outerRadius={88} paddingAngle={3}>
                {statusData.map((s, i) => (
                  <Cell key={i} fill={s.color} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
              <Legend verticalAlign="bottom" height={30} iconSize={9} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <Insight text={statusInsight} />
          <DataNote>
            Per-student "active / left" status isn't tracked in the dataset, so this shows the clean mainstreamed split.
          </DataNote>
        </Card>

        <Card title="Boys and girls, by programme" sub="Enrolment split · all programmes">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={genderData} barSize={26} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--oo-border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "var(--oo-text)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "var(--oo-text)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={compact} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--oo-canvas)" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
              <Bar dataKey="Boys" fill="#6697C6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Girls" fill="#E76EA4" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <Insight text={genderInsight} />
        </Card>
      </div>

      <div style={{ marginTop: 24 }}>
        <Card title="Early warning — learners showing dropout signals" sub={`${fmtInt(flagged)} flagged of ${fmtInt(risk.nonMainstreamed)} not-yet-mainstreamed learners`}>
          <div className="cbands">
            <div className="cband"><span className="dot" style={{ background: "var(--oo-danger)" }} /><span className="n tnum">{fmtInt(risk.bands.Critical)}</span><span className="lb">Critical (3 signals)</span></div>
            <div className="cband"><span className="dot" style={{ background: "var(--oo-warning)" }} /><span className="n tnum">{fmtInt(risk.bands.High)}</span><span className="lb">High (2)</span></div>
            <div className="cband"><span className="dot" style={{ background: "#E6B800" }} /><span className="n tnum">{fmtInt(risk.bands.Elevated)}</span><span className="lb">Elevated (1)</span></div>
          </div>
          <div style={{ marginTop: 10 }}>
            {risk.top.map((s) => {
              const c = s.signals >= 3 ? "var(--oo-danger)" : s.signals === 2 ? "var(--oo-warning)" : "#E6B800";
              return (
                <div className="crow" key={s.student_id}>
                  <div className="cscore" style={{ background: c }}>{s.signals}<small>SIG</small></div>
                  <div>
                    <div className="cname">{s.student_name || s.student_id}</div>
                    <div className="cmeta">{s.programme} · {s.division ?? "—"}{s.reason ? <> · <b>{s.reason}</b></> : ""}</div>
                  </div>
                  <div className="cfactors">
                    {s.attendance != null && <span className="cfac">Attendance {s.attendance}%</span>}
                    {s.avg_mark != null && <span className="cfac">Score {s.avg_mark}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <Insight text={`${fmtInt(risk.bands.High + risk.bands.Critical)} learners show 2+ dropout signals (recorded dropout reason, attendance below 50%, or marks below 20). Contact the top of this list first.`} />
          <DataNote>Real early-warning: signals counted from the actual dropout reason, recorded attendance and marks — no synthetic score. Attendance and marks are coverage-limited, so a missing signal can mean "not recorded" rather than "fine".</DataNote>
        </Card>
      </div>

      <div style={{ marginTop: 24 }}>
        <Card title="Why children leave — dropout reasons" sub={`${fmtInt(totalDropouts)} recorded dropouts · all programmes`}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dropoutData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--oo-border)" vertical={false} />
              <XAxis dataKey="reason" tick={{ fill: "var(--oo-text)", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={{ fill: "var(--oo-text)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={compact} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--oo-canvas)" }} />
              <Bar dataKey="count" name="Learners" radius={[3, 3, 0, 0]}>
                {dropoutData.map((d2, i) => (
                  <Cell key={i} fill={d2.reason === "Poverty" ? "var(--oo-danger)" : "var(--series-3)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <Insight text={dropoutInsight} />
          <DataNote>Poverty-linked dropouts are the highest-leverage list to cross-check against the cash-transfer roster.</DataNote>
        </Card>
      </div>
    </>
  );
}

export default StudentsView;
