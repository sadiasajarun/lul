import { useState, useEffect } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { narrate } from "../utils/insights";
import { fmtInt } from "../lib/fmt";
import { Card, ChartTooltip, Insight, DataNote } from "./dashShared";
import { getDataSource } from "../lib/db";
import { loadEquity, type EquityData } from "../lib/db/equity-query";

/**
 * EQUITY section — real demographics (disability, ethnicity, religion, nutrition) and a real
 * disability-by-division cross-tab, all computed from v_students via the engine.
 */

const CATS = ["#00C19C", "#6697C6", "#CC6AC2", "#FED236", "#36A9E2", "#666EE8", "#FF9149"];
const compact = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v));
const sum = (arr: { value: number }[]) => arr.reduce((s, d) => s + d.value, 0);
const nutColor = (n: string) => (/^good/i.test(n) ? "var(--oo-success)" : /not so good/i.test(n) ? "var(--oo-warning)" : "var(--oo-danger)");

export function EquityView() {
  const [d, setD] = useState<EquityData | null>(null);
  useEffect(() => {
    let cancelled = false;
    const ds = getDataSource();
    loadEquity((sql) => ds.query(sql)).then((r) => { if (!cancelled) setD(r); }).catch((e) => console.error("equity load failed", e));
    return () => { cancelled = true; };
  }, []);

  if (!d) return <div style={{ padding: 24, color: "var(--oo-muted)", fontSize: 13 }}>Loading equity…</div>;

  const { disability, ethnicity, religion, nutrition, disabilityByDivision } = d;
  const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "stretch" };

  const disTotal = sum(disability);
  const disInsight = narrate(
    `${fmtInt(disTotal)} children have a recorded disability — most commonly ${disability[0]?.name} (${fmtInt(disability[0]?.value ?? 0)})` +
      `${disability[1] ? ` and ${disability[1].name} (${fmtInt(disability[1].value)})` : ""}. A small but real group worth targeted support.`,
    { rows: disability, total: disTotal }
  );
  const ethTotal = sum(ethnicity);
  const ethInsight = narrate(
    `${fmtInt(ethTotal)} children are from ethnic-minority groups, the largest being ${ethnicity[0]?.name} (${fmtInt(ethnicity[0]?.value ?? 0)}).`,
    { rows: ethnicity, total: ethTotal }
  );
  const disDivInsight = narrate(
    `${disabilityByDivision[0]?.division} has the most children with a recorded disability (${fmtInt(disabilityByDivision[0]?.value ?? 0)})` +
      `${disabilityByDivision[1] ? `, followed by ${disabilityByDivision[1].division} (${fmtInt(disabilityByDivision[1].value)})` : ""} — target support there first.`,
    { rows: disabilityByDivision }
  );
  const badNutrition = nutrition.find((n) => /^bad/i.test(n.name))?.value ?? 0;

  return (
    <>
      <div className="row-2" style={grid2}>
        <Card title="Children with disabilities, by type" sub={`${fmtInt(disTotal)} children · all programmes`}>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={disability} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={86} paddingAngle={2}>
                {disability.map((_, i) => (<Cell key={i} fill={CATS[i % CATS.length]} />))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
              <Legend verticalAlign="bottom" height={40} iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
          <Insight text={disInsight} />
        </Card>

        <Card title="Ethnic-minority children" sub={`${fmtInt(ethTotal)} children · all programmes`}>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={ethnicity} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--oo-border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "var(--oo-text)", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={{ fill: "var(--oo-text)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={compact} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--oo-canvas)" }} />
              <Bar dataKey="value" name="Children" fill="#6697C6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <Insight text={ethInsight} />
        </Card>
      </div>

      <div className="row-2" style={{ ...grid2, marginTop: 24 }}>
        <Card title="Religion" sub="Enrolment by religion · all programmes">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={religion} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={86} paddingAngle={2}>
                {religion.map((_, i) => (<Cell key={i} fill={CATS[i % CATS.length]} />))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
              <Legend verticalAlign="bottom" height={40} iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Nutrition status" sub="Recorded nutrition assessment">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={nutrition} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--oo-border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "var(--oo-text)", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={{ fill: "var(--oo-text)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={compact} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--oo-canvas)" }} />
              <Bar dataKey="value" name="Children" radius={[3, 3, 0, 0]}>
                {nutrition.map((n, i) => (<Cell key={i} fill={nutColor(n.name)} />))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <DataNote>{fmtInt(badNutrition)} children are recorded "Bad" nutrition — small, but a direct welfare flag.</DataNote>
        </Card>
      </div>

      <div style={{ marginTop: 24 }}>
        <Card title="Children with disabilities, by division" sub="Where to target support geographically">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={disabilityByDivision} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--oo-border)" vertical={false} />
              <XAxis dataKey="division" tick={{ fill: "var(--oo-text)", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={{ fill: "var(--oo-text)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={compact} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--oo-canvas)" }} />
              <Bar dataKey="value" name="Children" fill="#36A9E2" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <Insight text={disDivInsight} />
          <DataNote>Disability and division live on the same student record, so this cross-tab is real — computed live from v_students.</DataNote>
        </Card>
      </div>
    </>
  );
}

export default EquityView;
