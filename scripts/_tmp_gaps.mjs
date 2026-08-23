import duckdb from 'duckdb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'public', 'data');
const SEM = path.join(HERE, '..', 'src', 'app', 'lib', 'db', 'semantic.sql');
const db = new duckdb.Database(':memory:');
const run = (s) => new Promise((res, rej) => db.all(s, (e, r) => (e ? rej(e) : res(r))));
const p = (f) => path.join(DATA, f).replace(/\\/g, '/');
const N = (v) => (typeof v === 'bigint' ? Number(v) : v);
const one = async (s) => Object.fromEntries(Object.entries((await run(s))[0]).map(([k, v]) => [k, N(v)]));
for (const t of ['students', 'attendance', 'assessments', 'teachers', 'centers'])
  await run(`CREATE TABLE ${t} AS SELECT * FROM read_csv_auto('${p(t + '.csv')}', header=true, sample_size=-1)`);
for (const s of fs.readFileSync(SEM, 'utf8').replace(/--[^\n]*/g, '').split(';').filter((x) => x.trim().length)) await run(s);
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) + '%' : '—');

console.log('=== ROW COUNTS ===');
for (const t of ['students', 'attendance', 'assessments', 'teachers', 'centers'])
  console.log('  ' + t.padEnd(12), N((await one(`SELECT count(*) c FROM ${t}`)).c).toLocaleString());

console.log('\n=== STUDENTS — field coverage (% present) ===');
const s = await one(`SELECT count(*) total,
  count(student_name) nm, count(division) dv, count(district) di, count(gender) ge, count(enrollment_year) yr,
  count(father_income_tk) inc, count(nutrition) nu, count(religion) re, count(disability_type) dis,
  count(ethnicity) et, count(dropout_reason) dr, count(admitted_grade) ag FROM v_students`);
for (const [k, l] of [['nm','student_name'],['dv','division'],['di','district'],['ge','gender'],['yr','enrollment_year'],['inc','father_income'],['nu','nutrition'],['re','religion'],['dis','disability_type'],['et','ethnicity'],['dr','dropout_reason'],['ag','admitted_grade']])
  console.log('  ' + l.padEnd(16), pct(s[k], s.total));

console.log('\n=== STATUS OVERLAP (mainstreamed vs dropout — ambiguity) ===');
console.log(JSON.stringify(await one(`SELECT count(*) FILTER(WHERE is_mainstreamed) mainstreamed, count(*) FILTER(WHERE is_dropout) has_dropout_reason,
  count(*) FILTER(WHERE is_mainstreamed AND is_dropout) BOTH, count(*) FILTER(WHERE is_active) active FROM v_students`)));

console.log('\n=== ATTENDANCE / ASSESSMENT coverage ===');
console.log('  attendance recorded:', pct((await one(`SELECT count(*) FILTER(WHERE is_recorded) r FROM v_attendance`)).r, (await one(`SELECT count(*) c FROM v_attendance`)).c));
console.log('  students with any mark:', pct((await one(`SELECT count(DISTINCT student_id) c FROM v_marks`)).c, s.total));
console.log('  marks by phase (cycle coverage):');
for (const r of await run(`SELECT phase, count(*) n FROM v_marks GROUP BY phase ORDER BY phase`)) console.log('    ' + r.phase, N(r.n).toLocaleString());
console.log('  subject zero-% (0 often = not assessed):');
for (const r of await run(`SELECT subject, round(100.0*count(*) FILTER(WHERE mark=0)/count(*),1) z FROM v_marks GROUP BY subject ORDER BY z DESC`)) console.log('    ' + String(r.subject).padEnd(13), N(r.z) + '% zero');

console.log('\n=== TEACHERS ===');
console.log(JSON.stringify(await one(`SELECT count(*) total, count(center_id) with_centre, count(*) FILTER(WHERE is_active) active FROM v_teachers`)));
console.log('  teachers vs students by division:');
for (const r of await run(`SELECT COALESCE(a.division,b.division) d, COALESCE(a.st,0) students, COALESCE(b.tt,0) teachers FROM
  (SELECT division, count(*) st FROM v_students GROUP BY 1) a FULL JOIN (SELECT division, count(*) tt FROM v_teachers WHERE division IS NOT NULL GROUP BY 1) b USING(division) ORDER BY students DESC`))
  console.log('    ' + String(r.d).padEnd(12), 'students', N(r.students).toLocaleString().padEnd(9), 'teachers', N(r.teachers).toLocaleString());

console.log('\n=== CENTRES ===');
const ce = await one(`SELECT count(DISTINCT center_id) sc FROM v_students`);
const cm = await one(`SELECT count(*) total, count(center_name) named, count(gps_lat) gps, count(overall_score) me FROM centers`);
console.log('  centres students belong to:', ce.sc.toLocaleString());
console.log('  in M&E export:', cm.total.toLocaleString(), '| with name:', cm.named, '| with GPS:', cm.gps, '| with M&E score:', cm.me);
console.log('  → centre metadata coverage:', pct(cm.total, ce.sc));
db.close();
