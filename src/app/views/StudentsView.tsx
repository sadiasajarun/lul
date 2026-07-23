import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { fmtInt } from "../lib/fmt";
import { narrate } from "../utils/insights";
import { programs, totals, PROGRAM_KEYS, PROGRAM_LABELS } from "../lib/aggregates";
import { Card, ChartTooltip, Insight, DataNote } from "./dashShared";
import risk from "../../../Database/demo/aggregates/risk.json";

/**
 * STUDENTS tab — ported from the prototype, wired to real aggregates. Status (mainstreamed vs still
 * enrolled), gender by programme, and why children leave (dropout reasons). The prototype's per-student
 * "children who may leave" risk score isn't computable from this data — we show the real driver instead.
 */

const compact = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v));

export function StudentsView() {
  const mainstreamed = totals.mainstreamed;
  const total = totals.students;
  const remaining = total - mainstreamed;
  const rate = Math.round((mainstreamed / total) * 1000) / 10;
  const statusData = [
    { name: "Mainstreamed", value: mainstreamed, color: "var(--series-1)" },
    { name: "Not yet mainstreamed", value: remaining, color: "var(--series-3)" },
  ];
  const statusInsight = narrate(
    `${fmtInt(mainstreamed)} of ${fmtInt(total)} learners (${rate}%) have been mainstreamed into formal school. ` +
      `The remaining ${fmtInt(remaining)} are still in the programme.`,
    { mainstreamed, total, remaining, rate }
  );

  const genderData = PROGRAM_KEYS.map((k) => ({ name: PROGRAM_LABELS[k], Boys: programs[k].boys, Girls: programs[k].girls }));
  const girlPct = (k: (typeof PROGRAM_KEYS)[number]) => Math.round((programs[k].girls / (programs[k].boys + programs[k].girls)) * 1000) / 10;
  const genderPayload = { catchup: girlPct("catchup"), abal: girlPct("abal"), innovation: girlPct("innovation") };
  const genderInsight = narrate(
    `Girls are at or above parity in every programme — Catchup ${genderPayload.catchup}%, ABAL ${genderPayload.abal}% and ` +
      `Innovation ${genderPayload.innovation}%. Equity of access is a genuine strength.`,
    genderPayload
  );

  const reasons: Record<string, number> = {};
  PROGRAM_KEYS.forEach((k) => Object.entries(programs[k].dropout_reasons).forEach(([r, n]) => (reasons[r] = (reasons[r] ?? 0) + n)));
  const dropoutData = Object.entries(reasons).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  const totalDropouts = dropoutData.reduce((s, d) => s + d.count, 0);
  const poverty = reasons["Poverty"] ?? 0;
  const povertyShare = Math.round((poverty / totalDropouts) * 1000) / 10;
  const dropoutInsight = narrate(
    `Poverty is the leading reason children leave — ${fmtInt(poverty)} learners, ${povertyShare}% of the ` +
      `${fmtInt(totalDropouts)} recorded dropouts. It outweighs every other reason combined.`,
    { poverty, totalDropouts, povertyShare, rows: dropoutData }
  );

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
        <Card title="Children who may leave school" sub={`${risk.bands.Critical + risk.bands.High + risk.bands.Elevated} flagged of ${risk.active.toLocaleString()} active learners`}>
          <div className="cbands">
            <div className="cband"><span className="dot" style={{ background: "var(--oo-danger)" }} /><span className="n tnum">{risk.bands.Critical}</span><span className="lb">Critical</span></div>
            <div className="cband"><span className="dot" style={{ background: "var(--oo-warning)" }} /><span className="n tnum">{risk.bands.High}</span><span className="lb">High</span></div>
            <div className="cband"><span className="dot" style={{ background: "#E6B800" }} /><span className="n tnum">{risk.bands.Elevated}</span><span className="lb">Elevated</span></div>
          </div>
          <div style={{ marginTop: 10 }}>
            {risk.top.slice(0, 8).map((s) => {
              const c = s.risk_band === "Critical" ? "var(--oo-danger)" : s.risk_band === "High" ? "var(--oo-warning)" : "#E6B800";
              return (
                <div className="crow" key={s.student_id}>
                  <div className="cscore" style={{ background: c }}>{s.risk_score}<small>{s.risk_band.slice(0, 4).toUpperCase()}</small></div>
                  <div>
                    <div className="cname">{s.name}</div>
                    <div className="cmeta">{s.program} · {s.division} · <b>{s.reason}</b></div>
                  </div>
                  <div className="cfactors">
                    <span className="cfac">Attendance {s.attendance_pct}%</span>
                    <span className="cfac">Score {s.latest_avg_score}</span>
                    {s.cash_missed > 0 && <span className="cfac bad">{s.cash_missed} cash missed</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <Insight text={`${risk.bands.High + risk.bands.Critical} learners are High or Critical risk of dropping out — falling attendance, low scores and missed cash payments are the strongest signals. Contact the top of this list first.`} />
          <DataNote>Risk is scored per learner from attendance, latest scores and missed cash payments — now that the demo data joins on student_id, this early-warning list is real.</DataNote>
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
                {dropoutData.map((d, i) => (
                  <Cell key={i} fill={d.reason === "Poverty" ? "var(--oo-danger)" : "var(--series-3)"} />
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
