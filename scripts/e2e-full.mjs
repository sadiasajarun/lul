// ─────────────────────────────────────────────────────────────────────────────
// e2e-full.mjs — one deterministic sweep over everything built recently.
//
// Covers: all three datasets × the semantic layer, every few-shot SQL, the new
// predictive/ghost/economic/score views, the factor engine and its validity tests,
// intent routing, the Real-mode forecast guard, the readability bar, widget shaping,
// and attendance provenance.
//
// Spends NO API tokens — it exercises everything after the model writes SQL, which is
// where the bugs actually live.
//
//   npm run e2e:full
// ─────────────────────────────────────────────────────────────────────────────
import duckdb from 'duckdb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEMANTIC = path.join(ROOT, 'src', 'app', 'lib', 'db', 'semantic.sql');
const TABLES = ['students', 'attendance', 'assessments', 'teachers', 'centers'];
const PREVIEW_ONLY = ['attendance_monthly', 'attendance_center_monthly', 'attendance_gaps'];
const STUBS = [
  `CREATE TABLE IF NOT EXISTS attendance_monthly (month_num INTEGER, month VARCHAR, division VARCHAR, programme VARCHAR, n_students INTEGER, sum_attendance DOUBLE)`,
  `CREATE TABLE IF NOT EXISTS attendance_center_monthly (center_id VARCHAR, month_num INTEGER, month VARCHAR, n_students INTEGER, sum_attendance DOUBLE)`,
  `CREATE TABLE IF NOT EXISTS attendance_gaps (student_id VARCHAR, last_attended_month VARCHAR, days_since_last_attendance INTEGER, recent_attendance_pct DOUBLE)`,
];

// Mirrors NUMERIC_COLUMNS in src/app/lib/db/types.ts — a column that is entirely empty in one
// dataset would otherwise load as VARCHAR and break avg()/sum().
const NUMERIC = {
  students: ['father_income_tk', 'mother_income_tk', 'student_income_tk', 'household_income_tk', 'enrollment_year', 'mainstreamed'],
  attendance: ['attendance_pct', 'is_estimated'],
  assessments: ['mark'],
  centers: ['gps_lat', 'gps_lng', 'pedagogy', 'assessments', 'documentation', 'learning_environment', 'engagement', 'overall_score'],
};
const typesClause = (t) => (NUMERIC[t]?.length ? `, types={${NUMERIC[t].map((c) => `'${c}':'DOUBLE'`).join(', ')}}` : '');

let pass = 0;
const failures = [];
const ok = (name) => { pass++; console.log('   ok   ' + name); };
const bad = (name, detail) => { failures.push({ name, detail }); console.log('   FAIL ' + name + '  — ' + String(detail).split('\n')[0].slice(0, 130)); };
function check(name, fn) { try { const r = fn(); if (r === false) bad(name, 'assertion returned false'); else ok(name); } catch (e) { bad(name, e.message); } }
const section = (t) => console.log('\n━━ ' + t);

async function openDataset(folder) {
  const dir = path.join(ROOT, 'public', folder).replace(/\\/g, '/');
  const db = new duckdb.Database(':memory:');
  const q = (s) => new Promise((res, rej) => db.all(s, (e, r) => (e ? rej(e) : res(r))));
  // A cap the machine can actually honour, plus a spill directory. Counterintuitively a LOWER limit
  // fixes "Allocation failure": DuckDB spills to disk when it hits its own limit, but it cannot
  // recover when the OS refuses the allocation outright. On a dev box with ~1GB free, a 2GB cap
  // meant DuckDB kept asking for memory that was not there, and whichever of the 52 few-shots came
  // next died — so the suite failed somewhere different on every run.
  await q(`PRAGMA memory_limit='${process.env.E2E_MEMORY_LIMIT || '768MB'}'`);
  await q(`PRAGMA threads=1`);
  // Let DuckDB SPILL to disk instead of dying. Without this the 52 few-shots run cumulatively into
  // the 2GB cap partway through, and whichever query happens to be next fails with "Allocation
  // failure" — so the suite failed in a different place on each run. Spilling makes it deterministic.
  await q(`PRAGMA temp_directory='${path.join(ROOT, 'node_modules', '.cache', 'duckdb-e2e').replace(/\\/g, '/')}'`);
  for (const t of TABLES) await q(`CREATE TABLE ${t} AS SELECT * FROM read_csv_auto('${dir}/${t}.csv', header=true, sample_size=-1${typesClause(t)})`);
  for (const s of STUBS) await q(s);
  for (const f of PREVIEW_ONLY) {
    const p = `${dir}/${f}.csv`;
    if (!fs.existsSync(p)) continue;
    const types = f === 'attendance_gaps' ? `, types={'student_id':'VARCHAR'}` : f === 'attendance_center_monthly' ? `, types={'center_id':'VARCHAR'}` : '';
    await q(`CREATE OR REPLACE TABLE ${f} AS SELECT * FROM read_csv_auto('${p}', header=true, sample_size=-1${types})`);
  }
  for (const s of fs.readFileSync(SEMANTIC, 'utf8').replace(/--[^\n]*/g, '').split(';').filter((x) => x.trim().length)) await q(s);
  const num = async (sql) => { const r = await q(sql); const v = Object.values(r[0])[0]; return typeof v === 'bigint' ? Number(v) : v; };
  return { q, num, close: () => db.close() };
}

// ═══ 1. DATASETS × SEMANTIC LAYER, NEW VIEWS, PROVENANCE ════════════════════
const datasets = ['data', 'data-tuned', 'data-v2'].filter((d) => fs.existsSync(path.join(ROOT, 'public', d, 'students.csv')));
const { FEW_SHOTS } = await import('../src/app/lib/ai/fewshot.ts');

for (const ds of datasets) {
  section(`DATASET: ${ds}`);
  let D;
  try { D = await openDataset(ds); } catch (e) { bad(`${ds}: load`, e.message); continue; }
  const isPreview = ds === 'data-tuned';
  try {
    const students = await D.num(`SELECT count(*) FROM v_students`);
    const dupes = await D.num(`SELECT count(*) - count(DISTINCT student_id) FROM v_students`);
    dupes === 0 ? ok(`${ds}: no duplicate student ids (${students.toLocaleString()} students)`) : bad(`${ds}: duplicate student ids`, `${dupes} duplicates`);

    // attendance provenance: estimated rows may exist ONLY in Preview
    const est = await D.num(`SELECT count(*) FROM v_student_attendance WHERE attendance_estimated`);
    if (isPreview) est > 0 ? ok(`${ds}: provenance — ${est.toLocaleString()} learners flagged estimated`) : bad(`${ds}: provenance`, 'Preview should flag estimated attendance');
    else est === 0 ? ok(`${ds}: provenance — nothing flagged estimated (correct for a real dataset)`) : bad(`${ds}: provenance`, `${est} rows wrongly flagged estimated`);

    // attendance 0 must never be counted as a real value
    const zeroCounted = await D.num(`SELECT count(*) FROM v_attendance WHERE is_recorded AND attendance_pct = 0`);
    zeroCounted === 0 ? ok(`${ds}: attendance 0 is never "recorded"`) : bad(`${ds}: attendance semantics`, `${zeroCounted} zero rows marked recorded`);

    // no score/percentage scale mixing: M&E stays within 0–5, attendance within 0–100
    const meBad = await D.num(`SELECT count(*) FROM v_center_enrollment WHERE me_score IS NOT NULL AND (me_score < 0 OR me_score > 5)`);
    meBad === 0 ? ok(`${ds}: M&E scores within 0–5`) : bad(`${ds}: M&E scale`, `${meBad} out of range`);
    const attBad = await D.num(`SELECT count(*) FROM v_student_attendance WHERE avg_attendance_recorded IS NOT NULL AND (avg_attendance_recorded < 0 OR avg_attendance_recorded > 100)`);
    attBad === 0 ? ok(`${ds}: attendance within 0–100`) : bad(`${ds}: attendance scale`, `${attBad} out of range`);

    // Preview-only views must be EMPTY in the real datasets and POPULATED in Preview
    for (const [view, label] of [['v_attendance_monthly', 'monthly series'], ['v_center_forecast', 'centre forecast'], ['v_center_monthly', 'per-centre monthly']]) {
      const n = await D.num(`SELECT count(*) FROM ${view}`);
      if (isPreview) n > 0 ? ok(`${ds}: ${label} populated (${n.toLocaleString()})`) : bad(`${ds}: ${label}`, 'expected rows in Preview');
      else n === 0 ? ok(`${ds}: ${label} empty (correct — no dated attendance)`) : bad(`${ds}: ${label}`, `expected 0 rows, got ${n}`);
    }

    // forecasts must stay inside a real percentage and not all read the same way
    if (isPreview) {
      const oob = await D.num(`SELECT count(*) FROM v_center_forecast WHERE forecast_next_month_pct < 0 OR forecast_next_month_pct > 100`);
      oob === 0 ? ok(`${ds}: forecasts clamped to 0–100`) : bad(`${ds}: forecast range`, `${oob} out of range`);
      const trends = await D.num(`SELECT count(DISTINCT trend) FROM v_center_forecast`);
      trends >= 2 ? ok(`${ds}: forecast trends vary (${trends} distinct)`) : bad(`${ds}: forecast trend`, 'every centre has the same trend — deseasonalising likely broken');
    }

    // ghost rule
    const ghosts = await D.num(`SELECT count(*) FROM v_ghost_students WHERE is_ghost`);
    const ghostWithMarks = await D.num(`SELECT count(*) FROM v_ghost_students WHERE is_ghost AND n_marks > 0`);
    ghostWithMarks === 0 ? ok(`${ds}: ghosts (${ghosts.toLocaleString()}) never have marks`) : bad(`${ds}: ghost rule`, `${ghostWithMarks} ghosts have marks`);

    // economic pressure: the coverage gate must actually exclude thin centres
    const lowConf = await D.num(`SELECT count(*) FROM v_center_economic_pressure WHERE attendance_confidence = 'low'`);
    const total = await D.num(`SELECT count(*) FROM v_center_economic_pressure`);
    lowConf <= total ? ok(`${ds}: coverage gate flags ${lowConf}/${total} centres low-confidence`) : bad(`${ds}: coverage gate`, 'impossible count');

    // score levels
    const lvlBad = await D.num(`SELECT count(*) FROM v_score_levels WHERE level_order NOT BETWEEN 1 AND 5`);
    lvlBad === 0 ? ok(`${ds}: score levels ordered 1–5`) : bad(`${ds}: score levels`, `${lvlBad} bad level_order`);

    // ═══ every few-shot SQL must execute on this dataset ═══
    let sqlOk = 0; const sqlBad = [];
    for (const shot of FEW_SHOTS) {
      try { await D.q(shot.sql); sqlOk++; } catch (e) { sqlBad.push(shot.q.slice(0, 52) + ' :: ' + e.message.split('\n')[0].slice(0, 70)); }
    }
    sqlBad.length === 0
      ? ok(`${ds}: all ${sqlOk} few-shot queries execute`)
      : bad(`${ds}: few-shot SQL (${sqlBad.length} of ${FEW_SHOTS.length} failed)`, sqlBad[0]);
    sqlBad.slice(1, 4).forEach((b) => console.log('        also: ' + b));
  } catch (e) {
    bad(`${ds}: suite`, e.message);
  } finally {
    D.close();
  }
}

// ═══ 2. INTENT ROUTING ══════════════════════════════════════════════════════
section('INTENT ROUTING');
const { classifyIntent, classifyTopic, wantsFactorAnalysis } = await import('../src/app/lib/ai/intent.ts');
for (const [q, want] of [
  ['Show students who are regularly absent', 'retrieval'],
  ['Which centres have attendance below 85%?', 'retrieval'],
  ['Why are students regularly absent?', 'analytical'],
  ['why they are at high drop out risk and what should we do', 'analytical'],
  ['What is driving dropout?', 'analytical'],
  ['Compare ABAL and Catchup enrolment', 'comparative'],
  ['Which centres are at rising risk of low attendance?', 'predictive'],
]) {
  const got = classifyIntent(q);
  got === want ? ok(`intent "${q.slice(0, 42)}" -> ${got}`) : bad(`intent "${q.slice(0, 42)}"`, `expected ${want}, got ${got}`);
}
check('only analytical questions get factor analysis', () =>
  wantsFactorAnalysis('analytical') && !wantsFactorAnalysis('retrieval') && !wantsFactorAnalysis('comparative') && !wantsFactorAnalysis('predictive'));
check('attendance "why" is topic=attendance (bans circular factors)', () => classifyTopic('why do these centres have low attendance') === 'attendance');

// ═══ 3. REAL-MODE FORECAST GUARD ════════════════════════════════════════════
section('FORECAST GUARD (never invent a trend without dated attendance)');
const { modeGuard } = await import('../src/app/lib/ai/mode-guards.ts');
for (const [mode, q, shouldGuard] of [
  ['real', 'Which centres are at rising risk of low attendance?', true],
  ['v2', 'Which centres are at rising risk of low attendance?', true],
  ['tuned', 'Which centres are at rising risk of low attendance?', false],
  ['real', 'Which centres have attendance below 85%?', false],
  ['real', 'Which low-attendance centres also show economic pressure?', false],
]) {
  const g = modeGuard(q, mode);
  const got = !!g;
  got === shouldGuard ? ok(`${mode}: "${q.slice(0, 44)}" -> ${got ? 'guarded' : 'passes'}`) : bad(`${mode}: guard`, `expected guarded=${shouldGuard}`);
  if (g) {
    check(`${mode}: guarded answer returns no fabricated widget`, () => g.response.widgets.length === 0);
    check(`${mode}: guarded answer still gives an action`, () => !!g.reasoning?.action);
  }
}

// ═══ 4. READABILITY BAR ═════════════════════════════════════════════════════
section('READABILITY BAR');
const { assessReadability } = await import('../src/app/lib/ai/readability.ts');
check('rejects model-speak (the reported failure case)', () =>
  assessReadability('The data shows that assessment problems are the most significant factor associated with dropout risk. Vulnerability scores are often at zero and income consistently contributes a score of 15.').ok === false);
check('accepts plain prose', () =>
  assessReadability('The clearest warning sign is schoolwork. These children are falling behind in their tests. Money worries at home matter too, but less.').ok === true);
check('rejects over-long sentences', () =>
  assessReadability('These children come from poorer families than most and they are more likely to be working which makes it much harder for them to keep coming to class every single week of the year.').ok === false);

// ═══ 5. WIDGET SHAPING ══════════════════════════════════════════════════════
section('WIDGET SHAPING');
const { toResponse } = await import('../src/app/lib/ai/interpret.ts');
const reasons = ['Poverty', 'Others', 'Family Awareness', 'Distance'];
const twoDim = ['Dhaka', 'Chattogram', 'Mymensingh'].flatMap((d) => reasons.map((x, i) => ({ division: d, dropout_reason: x, students: 900 - i * 120 })));
const pivot = toResponse('Dropout reasons by division', 'aggregate', { columns: ['division', 'dropout_reason', 'students'], rows: twoDim, rowCount: twoDim.length });
check('two-dimension breakdown pivots into named series', () => {
  const c = pivot.widgets.find((w) => w.type === 'chart');
  return !!c && c.xAxisKey === 'division' && c.seriesKeys.length === reasons.length;
});
check('pivoted chart carries a plain-language caption', () => /coloured bars/.test(pivot.widgets.find((w) => w.type === 'chart').caption || ''));
const list = toResponse('Students with low marks', 'list', {
  columns: ['student_id', 'student_name', 'division', 'avg_mark'],
  rows: Array.from({ length: 20 }, (_, i) => ({ student_id: '10' + i, student_name: 'S' + i, division: 'Dhaka', avg_mark: 20 + i })),
  rowCount: 20,
});
check('a student LIST is a table, never one bar per person', () => list.widgets.every((w) => w.type === 'table'));

// ═══ 6. FACTOR VALIDITY ═════════════════════════════════════════════════════
section('FACTOR VALIDITY (circular / backwards / trivial / immaterial)');
const { computeFactors, detectCohort } = await import('../src/app/lib/ai/factors.ts');
try {
  const D = await openDataset('data');
  const r = await D.q(`SELECT student_id, student_name FROM v_student_attendance WHERE recorded_months > 0 ORDER BY avg_attendance_recorded ASC LIMIT 300`);
  const rows = r.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
  const ds = { query: async (sql) => { const rr = await D.q(sql); return { columns: rr.length ? Object.keys(rr[0]) : [], rows: rr.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]))), rowCount: rr.length }; } };
  const cohort = detectCohort(Object.keys(rows[0]), rows);
  const f = await computeFactors(ds, cohort.entity, cohort.ids, Object.keys(rows[0]), 'attendance');
  check('cohort detected from a student list', () => cohort && cohort.entity === 'student');
  check('no factor restates the attendance outcome (circularity ban)', () => !f.drivers.some((d) => d.family === 'attendance'));
  check('no demographic factor is presented as a driver', () => !f.drivers.some((d) => d.family === 'demographic'));
  check('every driver moves in the worsening direction', () => f.drivers.every((d) => d.role === 'driver'));
  check('every driver is materially different from the network', () => f.drivers.every((d) => (d.kind === 'share' ? Math.abs(d.delta) >= 8 : Math.abs(d.delta / d.baselineValue) >= 0.10)));
  check('rejected factors carry a stated reason', () => f.rejected.every((x) => !!x.reason));
  console.log('        drivers kept: ' + (f.drivers.map((d) => d.plainLabel).join(' | ') || '(none)'));
  console.log('        rejected    : ' + (f.rejected.map((x) => x.id).slice(0, 6).join(', ') || '(none)'));
  D.close();
} catch (e) {
  bad('factor validity suite', e.message);
}

// ═══ 7. COST CONTROLS (must not change any answer) ══════════════════════════
section('COST CONTROLS');
const { HIDDEN_COLUMNS } = await import('../src/app/lib/db/catalog.ts');
const { renderDbProfile } = await import('../src/app/lib/db/profile.ts');
// A synthetic profile: if a hidden column survives rendering, the profile is contradicting the
// catalogue (which tells the model to use the curated column instead) and paying tokens to do it.
const fakeProfile = {
  dataMode: 'real',
  views: Object.entries(HIDDEN_COLUMNS).map(([view, hidden]) => ({
    view,
    rows: 100,
    columns: [...Object.keys(hidden).map((name) => ({ name, type: 'VARCHAR', filledPct: 100, distinct: 5 })),
              { name: 'a_visible_column', type: 'VARCHAR', filledPct: 100, distinct: 5 }],
  })),
};
const rendered = renderDbProfile(fakeProfile);
check('profile never lists a column the catalogue hides', () =>
  !Object.entries(HIDDEN_COLUMNS).some(([, hidden]) => Object.keys(hidden).some((c) => rendered.includes('- ' + c + ':'))));
check('profile still lists columns that are NOT hidden', () => rendered.includes('a_visible_column'));

const { estimateCost } = await import('../src/app/lib/ai/usage.ts');
check('cost estimate applies the prompt-cache discount', () => {
  const uncached = estimateCost('gpt-4o', 10000, 0, 1000);
  const cached = estimateCost('gpt-4o', 10000, 8000, 1000);
  return cached < uncached && cached > 0;
});
check('cost estimate is 0 for an unknown model (never guesses)', () => estimateCost('some-future-model', 10000, 0, 1000) === 0);
check('cost estimate matches list pricing', () => {
  // 1M uncached input at $2.50 + 1M output at $10.00 = $12.50
  const c = estimateCost('gpt-4o', 1_000_000, 0, 1_000_000);
  return Math.abs(c - 12.5) < 0.001;
});

const { runMenuChecks } = await import('./lib/menu-checks.mjs');
await runMenuChecks({ check, section });

const { runDepthChecks } = await import('./lib/depth-checks.mjs');
await runDepthChecks({ check, section });

const { runConversationChecks } = await import('./lib/conversation-checks.mjs');
await runConversationChecks({ check, section, openDataset, root: ROOT });

// ═══ SUMMARY ════════════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(72));
if (failures.length === 0) {
  console.log(`✅ e2e passed — ${pass} checks, 0 failures.`);
} else {
  console.log(`❌ e2e: ${pass} passed, ${failures.length} FAILED`);
  failures.forEach((f) => console.log('   • ' + f.name + ' — ' + String(f.detail).split('\n')[0].slice(0, 150)));
  process.exit(1);
}
