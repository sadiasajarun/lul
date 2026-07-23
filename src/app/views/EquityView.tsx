import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import demographics from "../../../Database/demo/aggregates/demographics.json";
import { narrate } from "../utils/insights";
import { fmtInt } from "../lib/fmt";
import { Card, ChartTooltip, Insight, DataNote } from "./dashShared";

/**
 * EQUITY tab — real demographics (disability, ethnicity, religion, nutrition), merged across the
 * three programmes. The prototype's disability-by-division MAP needs a disability×division cross-tab
 * that isn't in the aggregates, so that's noted rather than faked.
 */

const DEMO = (demographics as unknown as { by_program: Record<string, Record<string, Record<string, number>>> }).by_program;
const DIS_BY_DIV = (demographics as unknown as { disability_by_division: Record<string, number> }).disability_by_division;
const PROGS = ["abal", "catchup", "innovation"];
const CATS = ["#00C19C", "#6697C6", "#CC6AC2", "#FED236", "#36A9E2", "#666EE8", "#FF9149"];
const EXCLUDE = ["Not Applicable", "-", "Unknown"];
const compact = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v));

function merge(dim: string, exclude: string[]): { name: string; value: number }[] {
  const out: Record<string, number> = {};
  PROGS.forEach((p) => Object.entries(DEMO[p]?.[dim] ?? {}).forEach(([k, v]) => { if (!exclude.includes(k)) out[k] = (out[k] ?? 0) + v; }));
  return Object.entries(out).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}
const sum = (arr: { value: number }[]) => arr.reduce((s, d) => s + d.value, 0);

export function EquityView() {
  const disability = merge("disability", EXCLUDE);
  const ethnicity = merge("ethnicity", EXCLUDE);
  const religion = merge("religion", EXCLUDE);
  const nutrition = merge("nutrition", ["-"]);

  const disTotal = sum(disability);
  const disInsight = narrate(
    `${fmtInt(disTotal)} children have a recorded disability — most commonly ${disability[0].name} (${fmtInt(disability[0].value)}) ` +
      `and ${disability[1].name} (${fmtInt(disability[1].value)}). A small but real group worth targeted support.`,
    { rows: disability, total: disTotal }
  );

  const ethTotal = sum(ethnicity);
  const ethInsight = narrate(
    `${fmtInt(ethTotal)} children are from ethnic-minority groups, the largest being ${ethnicity[0].name} (${fmtInt(ethnicity[0].value)}).`,
    { rows: ethnicity, total: ethTotal }
  );

  const disDivData = Object.entries(DIS_BY_DIV).map(([division, value]) => ({ division, value })).sort((a, b) => b.value - a.value);
  const disDivInsight = narrate(
    `${disDivData[0].division} has the most children with a recorded disability (${disDivData[0].value}), followed by ${disDivData[1].division} (${disDivData[1].value}) — target support there first.`,
    { rows: disDivData }
  );
  const nutColor = (n: string) => (/^good/i.test(n) ? "var(--oo-success)" : /not so good/i.test(n) ? "var(--oo-warning)" : "var(--oo-danger)");
  const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "stretch" };

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
          <DataNote>336 children are recorded "Bad" nutrition — small, but a direct welfare flag.</DataNote>
        </Card>
      </div>

      <div style={{ marginTop: 24 }}>
        <Card title="Children with disabilities, by division" sub="Where to target support geographically">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={disDivData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--oo-border)" vertical={false} />
              <XAxis dataKey="division" tick={{ fill: "var(--oo-text)", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={{ fill: "var(--oo-text)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={compact} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--oo-canvas)" }} />
              <Bar dataKey="value" name="Children" fill="#36A9E2" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <Insight text={disDivInsight} />
          <DataNote>Now that disability and division live on the same joined record, this cross-tab is real — it replaces the prototype's static division map.</DataNote>
        </Card>
      </div>
    </>
  );
}

export default EquityView;
