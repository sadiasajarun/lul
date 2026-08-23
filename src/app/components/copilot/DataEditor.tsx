import { useEffect, useState } from "react";
import { X, Database, Columns3, Plus, Pencil } from "lucide-react";
import { getDataSource, getDataMode } from "../../lib/db";
import { applyAndPersist, EDITABLE_TABLES, ID_COL, type EditableTable } from "../../lib/db/overlay-store";

type Tab = "field" | "record" | "cell";
const TABS: { id: Tab; label: string; icon: typeof Columns3 }[] = [
  { id: "field", label: "Add field", icon: Columns3 },
  { id: "record", label: "Add record", icon: Plus },
  { id: "cell", label: "Edit a cell", icon: Pencil },
];

/** Editable/extendable dataset overlay UI. Add fields, add records, edit cells — persisted and
 *  re-applied on load, then reflected in the AI's queries. The LLM stays read-only; only this writes. */
export function DataEditor({ onClose }: { onClose: () => void }) {
  const [table, setTable] = useState<EditableTable>("students");
  const [tab, setTab] = useState<Tab>("field");
  const [columns, setColumns] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const preview = getDataMode() === "tuned";

  const [fName, setFName] = useState("");
  const [fType, setFType] = useState("VARCHAR");
  const [rec, setRec] = useState<Record<string, string>>({});
  const [cId, setCId] = useState("");
  const [cCol, setCCol] = useState("");
  const [cVal, setCVal] = useState("");

  const idCol = ID_COL[table];

  const loadCols = async () => {
    try { const r = await getDataSource().query(`SELECT * FROM ${table} LIMIT 1`); setColumns(r.columns); setCCol((c) => c || r.columns[0] || ""); }
    catch { setColumns([]); }
  };
  useEffect(() => { setRec({}); setCCol(""); void loadCols(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [table]);

  const flash = (ok: boolean, text: string) => { setMsg({ ok, text }); setTimeout(() => setMsg(null), 2800); };
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); await loadCols(); flash(true, ok); }
    catch (e) { flash(false, (e as Error).message); }
    finally { setBusy(false); }
  };

  const input = "w-full bg-[var(--oo-canvas)] border border-[var(--oo-input-border)] rounded-md px-3 py-2 text-[13px] text-[var(--oo-heading)] outline-none focus:border-[var(--oo-primary)]";

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-lg rounded-2xl overflow-hidden" style={{ boxShadow: "0 20px 60px -20px rgba(0,0,0,.5)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--oo-border)]">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-[var(--oo-primary)]" />
            <h3 className="font-head text-[15px] font-semibold text-[var(--oo-heading)]">Edit dataset</h3>
          </div>
          <button onClick={onClose} className="text-[var(--oo-muted)] hover:text-[var(--oo-heading)] cursor-pointer" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {!preview && (
            <div className="text-[11.5px] text-[#8a4a1d] bg-[var(--oo-warning)]/10 border border-[var(--oo-warning)]/25 rounded-md px-3 py-2">
              You're in <b>Real</b> mode. Edits apply to the in-browser copy for this session — switch to <b>Preview</b> for the editable/estimated dataset.
            </div>
          )}

          {/* table + tabs */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-[var(--oo-muted)] uppercase tracking-wide">Table</span>
            {EDITABLE_TABLES.map((t) => (
              <button key={t} onClick={() => setTable(t)} className={`text-[12px] font-semibold px-3 py-1 rounded-md cursor-pointer transition-colors ${table === t ? "bg-[var(--oo-primary)] text-white" : "bg-[var(--oo-canvas)] text-[var(--oo-text)] hover:text-[var(--oo-primary)]"}`}>{t}</button>
            ))}
          </div>
          <div className="flex gap-1 bg-[var(--oo-canvas)] border border-[var(--oo-border)] rounded-md p-0.5">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)} className={`flex-1 flex items-center justify-center gap-1.5 text-[12px] font-semibold py-1.5 rounded transition-colors cursor-pointer ${tab === id ? "bg-white text-[var(--oo-primary)] shadow-sm" : "text-[var(--oo-muted)] hover:text-[var(--oo-heading)]"}`}><Icon size={13} />{label}</button>
            ))}
          </div>

          {tab === "field" && (
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-[var(--oo-text)]">New field name</label>
              <input className={input} value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. guardian_phone" />
              <label className="text-[11px] font-semibold text-[var(--oo-text)]">Type</label>
              <select className={input} value={fType} onChange={(e) => setFType(e.target.value)}>
                {["VARCHAR", "INTEGER", "DOUBLE", "BOOLEAN", "DATE"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button disabled={busy} onClick={() => run(async () => { if (!fName.trim()) throw new Error("field name required"); await applyAndPersist(getDataSource(), { op: "addField", table, name: fName.trim(), type: fType }); setFName(""); }, `Added "${fName}" to ${table}`)} className="w-full bg-[var(--oo-primary)] text-white font-semibold text-[13px] py-2 rounded-md hover:brightness-105 disabled:opacity-50 cursor-pointer">Add field</button>
            </div>
          )}

          {tab === "record" && (
            <div className="space-y-2 max-h-[42vh] overflow-y-auto pr-1">
              {columns.map((c) => (
                <div key={c}>
                  <label className="text-[11px] font-semibold text-[var(--oo-text)]">{c}{c === idCol ? " *" : ""}</label>
                  <input className={input} value={rec[c] ?? ""} onChange={(e) => setRec((r) => ({ ...r, [c]: e.target.value }))} placeholder={c === idCol ? "required" : "optional"} />
                </div>
              ))}
              <button disabled={busy} onClick={() => run(async () => { const id = (rec[idCol] ?? "").trim(); if (!id) throw new Error(`${idCol} is required`); const values: Record<string, unknown> = {}; for (const [k, v] of Object.entries(rec)) if (v !== "") values[k] = v; values[idCol] = id; await applyAndPersist(getDataSource(), { op: "addRow", table, idCol, values }); setRec({}); }, `Added record to ${table}`)} className="w-full bg-[var(--oo-primary)] text-white font-semibold text-[13px] py-2 rounded-md hover:brightness-105 disabled:opacity-50 cursor-pointer sticky bottom-0">Add record</button>
            </div>
          )}

          {tab === "cell" && (
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-[var(--oo-text)]">{idCol}</label>
              <input className={input} value={cId} onChange={(e) => setCId(e.target.value)} placeholder="the record's id" />
              <label className="text-[11px] font-semibold text-[var(--oo-text)]">Column</label>
              <select className={input} value={cCol} onChange={(e) => setCCol(e.target.value)}>{columns.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              <label className="text-[11px] font-semibold text-[var(--oo-text)]">New value</label>
              <input className={input} value={cVal} onChange={(e) => setCVal(e.target.value)} placeholder="value (blank = NULL)" />
              <button disabled={busy} onClick={() => run(async () => { if (!cId.trim() || !cCol) throw new Error("id and column required"); await applyAndPersist(getDataSource(), { op: "setCell", table, idCol, id: cId.trim(), col: cCol, value: cVal }); }, `Updated ${cCol} for ${cId}`)} className="w-full bg-[var(--oo-primary)] text-white font-semibold text-[13px] py-2 rounded-md hover:brightness-105 disabled:opacity-50 cursor-pointer">Update cell</button>
            </div>
          )}

          {msg && <div className={`text-[12px] font-semibold ${msg.ok ? "text-[var(--oo-success)]" : "text-[var(--oo-danger)]"}`}>{msg.ok ? "✓ " : "✕ "}{msg.text}</div>}
          <p className="text-[10.5px] text-[var(--oo-muted)] leading-relaxed">Edits persist in your browser and are re-applied on reload; the AI can immediately query added fields and records.</p>
        </div>
      </div>
    </div>
  );
}

export default DataEditor;
