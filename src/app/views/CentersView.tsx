import centersData from "../../../Database/demo/aggregates/centers.json";
import { narrate } from "../utils/insights";
import { fmtInt } from "../lib/fmt";
import { Card, Insight, DataNote } from "./dashShared";

/**
 * CENTERS & FIELD tab — the real prototype "centres that need a visit", now fully backed by the demo
 * data: ranked by an urgency score (days since visit · attendance · M&E · at-risk), with the visit /
 * attendance / at-risk / M&E chips the prototype showed.
 */

interface CentreRow {
  center_id: string; center_name: string; program: string; division: string; district: string;
  score: number; avg_attendance: number; days_since_visit: number; visit_count: number;
  at_risk: number; students: number; urgency: number; band: string;
}
const CENTERS = (centersData as { centers: CentreRow[] }).centers;

function urgencyStyle(u: number): { c: string; t: string } {
  if (u >= 80) return { c: "var(--oo-danger)", t: "CRIT" };
  if (u >= 60) return { c: "var(--oo-warning)", t: "HIGH" };
  if (u >= 40) return { c: "#E6B800", t: "ELEV" };
  return { c: "var(--oo-success)", t: "LOW" };
}

export function CentersView() {
  const total = CENTERS.length;
  const poor = CENTERS.filter((c) => c.band === "Poor").length;
  const fair = CENTERS.filter((c) => c.band === "Fair").length;
  const good = CENTERS.filter((c) => c.band === "Good").length;
  const overdue = CENTERS.filter((c) => c.days_since_visit >= 40).length;
  const worst = CENTERS.slice(0, 10); // already sorted by urgency desc

  const insight = narrate(
    `Of ${fmtInt(total)} centres, ${overdue} haven't been visited in 40+ days and ${poor} score Poor on M&E. Route field officers to the top of this list first.`,
    { total, overdue, poor }
  );

  const bands = [
    { label: "Poor (<2)", n: poor, color: "var(--oo-danger)" },
    { label: "Fair (2–3)", n: fair, color: "var(--oo-warning)" },
    { label: "Good (≥3)", n: good, color: "var(--oo-success)" },
  ];

  return (
    <Card title="Centres that need a visit" sub={`${fmtInt(total)} centres · ranked by how urgently they need attention`}>
      <div className="cbands">
        {bands.map((b) => (
          <div className="cband" key={b.label}>
            <span className="dot" style={{ background: b.color }} />
            <span className="n tnum">{b.n}</span>
            <span className="lb">{b.label}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        {worst.map((c) => {
          const u = urgencyStyle(c.urgency);
          const attBad = c.avg_attendance < 70;
          const visitBad = c.days_since_visit >= 40;
          return (
            <div className="crow" key={c.center_id}>
              <div className="cscore" style={{ background: u.c }}>{c.urgency}<small>{u.t}</small></div>
              <div>
                <div className="cname">{c.center_name}</div>
                <div className="cmeta">{c.program.toUpperCase()} · {c.division} › {c.district} · {c.students} students</div>
              </div>
              <div className="cfactors">
                <span className={`cfac ${visitBad ? "bad" : ""}`}>Not visited {c.days_since_visit}d</span>
                <span className={`cfac ${attBad ? "bad" : ""}`}>Attendance {c.avg_attendance}%</span>
                {c.at_risk > 0 && <span className="cfac bad">{c.at_risk} at-risk</span>}
                <span className={`cfac ${c.band === "Poor" ? "bad" : ""}`}>M&E {c.score.toFixed(2)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="seeall">Showing the 10 most urgent of {fmtInt(total)} centres. Ask the Copilot for any centre, division or programme.</div>

      <Insight text={insight} />
      <DataNote>Urgency blends days-since-visit, attendance, M&amp;E score and at-risk learners — all real in the demo dataset (the real export had no per-centre visit log).</DataNote>
    </Card>
  );
}

export default CentersView;
