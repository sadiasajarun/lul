import { useState, useEffect } from "react";
import { narrate } from "../utils/insights";
import { fmtInt } from "../lib/fmt";
import { Card, Insight, DataNote } from "./dashShared";
import { getDataSource } from "../lib/db";
import { loadCenters, type CentersData } from "../lib/db/centers-query";

/**
 * CENTERS & FIELD section — "centres that need a visit", from the REAL data via the engine.
 * Ranked by urgency built from M&E score + recorded attendance. The raw export has no per-centre
 * visit log or at-risk count, so those demo chips are dropped and the ranking says so.
 */

function urgencyStyle(u: number): { c: string; t: string } {
  if (u >= 80) return { c: "var(--oo-danger)", t: "CRIT" };
  if (u >= 60) return { c: "var(--oo-warning)", t: "HIGH" };
  if (u >= 40) return { c: "#E6B800", t: "ELEV" };
  return { c: "var(--oo-success)", t: "LOW" };
}

export function CentersView() {
  const [d, setD] = useState<CentersData | null>(null);
  useEffect(() => {
    let cancelled = false;
    const ds = getDataSource();
    loadCenters((sql) => ds.query(sql)).then((r) => { if (!cancelled) setD(r); }).catch((e) => console.error("centers load failed", e));
    return () => { cancelled = true; };
  }, []);

  if (!d) return <div style={{ padding: 24, color: "var(--oo-muted)", fontSize: 13 }}>Loading centres…</div>;

  const { totalCentres, totalEvaluated, bands, worst } = d;
  const insight = narrate(
    `Of ${fmtInt(totalEvaluated)} evaluated centres, ${bands.Poor} score Poor on M&E. Route field officers to the top of this list first.`,
    { totalEvaluated, poor: bands.Poor }
  );
  const bandRows = [
    { label: "Poor (<2)", n: bands.Poor, color: "var(--oo-danger)" },
    { label: "Fair (2–3)", n: bands.Fair, color: "var(--oo-warning)" },
    { label: "Good (≥3)", n: bands.Good, color: "var(--oo-success)" },
  ];

  return (
    <Card title="Centres that need a visit" sub={`${fmtInt(totalEvaluated)} evaluated of ${fmtInt(totalCentres)} centres · ranked by urgency`}>
      <div className="cbands">
        {bandRows.map((b) => (
          <div className="cband" key={b.label}>
            <span className="dot" style={{ background: b.color }} />
            <span className="n tnum">{fmtInt(b.n)}</span>
            <span className="lb">{b.label}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        {worst.map((c) => {
          const u = urgencyStyle(c.urgency);
          const attBad = c.attendance != null && c.attendance < 70;
          return (
            <div className="crow" key={c.center_id}>
              <div className="cscore" style={{ background: u.c }}>{c.urgency}<small>{u.t}</small></div>
              <div>
                <div className="cname">{c.center_name || c.center_id}</div>
                <div className="cmeta">{c.division ?? "—"} · {fmtInt(c.students)} students · {fmtInt(c.teachers)} teacher{c.teachers === 1 ? "" : "s"}</div>
              </div>
              <div className="cfactors">
                <span className={`cfac ${c.band === "Poor" ? "bad" : ""}`}>M&E {c.me_score.toFixed(2)}</span>
                {c.attendance != null && <span className={`cfac ${attBad ? "bad" : ""}`}>Attendance {c.attendance}%</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="seeall">Showing the 10 most urgent of {fmtInt(totalEvaluated)} evaluated centres. Ask the Copilot for any centre, division or programme.</div>

      <Insight text={insight} />
      <DataNote>Urgency blends M&amp;E score and recorded attendance — the only real per-centre signals. The raw export has no visit log or per-centre at-risk count, and ~39% of centres have no M&amp;E evaluation, so they can't be ranked here.</DataNote>
    </Card>
  );
}

export default CentersView;
