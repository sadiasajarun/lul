/**
 * ANSWERING WITHOUT A QUERY — definitions, and questions about the data itself.
 *
 * Both kinds share one mechanism, and the mechanism is the point:
 *
 *   1. A FACTS BLOCK is assembled deterministically — glossary entries with their real weights, or
 *      the live database profile with its real row counts and coverage percentages. Nothing in it
 *      is written by a model.
 *   2. The model composes an answer to the QUESTION ACTUALLY ASKED, using only that block.
 *   3. The answer is CHECKED: every substantial number in it must appear in the facts block or in
 *      the user's own question. A composed answer that invents a figure is discarded and the
 *      deterministic text is sent instead.
 *
 * Step 3 is what makes "never fabricate a number" a property of the system rather than a request in
 * a prompt. The cost is small: the facts block is a few hundred tokens, against ~15,700 for the
 * full analyst prompt, so an explanation is roughly a twentieth the cost of a query answer.
 */
import type { DataSource } from '../db/types';
import type { AskResult, Generate } from './pipeline';
import { GLOSSARY, findTerms, renderTermFacts, renderTermAnswer, type GlossaryEntry } from './glossary';
import { getDbProfile, type DbProfile } from '../db/profile';
import { CAVEATS, VIEWS } from '../db/catalog';
import { caveatsFor } from './coverage';
import { MODULES } from '../modules';
import { aiLog } from './debug';

/**
 * KNOWN LIMITS — what this system genuinely cannot answer, why, and what would change it.
 *
 * Every entry names the SPECIFIC missing field, not "insufficient data". A vague limitation is
 * indistinguishable from a bug, and leaves the client with nothing to act on; naming the field
 * turns a dead end into a requirement they can put to the data team.
 */
export interface KnownLimit {
  id: string;
  /** What the user was trying to do. */
  question: string;
  /** Exactly what is missing. */
  missing: string;
  /** What would need to be collected to lift it. */
  wouldNeed: string;
  /** Something close by that CAN be answered today. */
  insteadAsk: string;
  match: RegExp;
}

export const KNOWN_LIMITS: KnownLimit[] = [
  {
    id: 'attendance_trend',
    question: 'Attendance over time — trends, month-by-month movement, or a forecast, in Real mode.',
    missing:
      'The attendance export holds ONE lifetime percentage per child, with no date column at all. There is no month attached to any figure, so there is no series to read a direction from. The monthly view (v_attendance_monthly) is empty in Real mode.',
    wouldNeed: 'Attendance logged with a date against it — monthly would be enough. A few months of dated attendance makes trends, seasonality and forecasts real rather than simulated.',
    insteadAsk: 'Which centres have attendance below 85% right now, or which low-attendance centres also show economic pressure.',
    match: /attendance (over time|trend|history|by month|month by month)|monthly attendance|attendance forecast|trend of attendance|attendance movement/i,
  },
  {
    id: 'dropout_timing',
    question: 'When a particular child will drop out.',
    missing:
      'There is no dated leaving event in the data. A child carries a dropout REASON, but nothing records when they left, so there is no time-to-event history to learn from. There is also no follow-up after leaving.',
    wouldNeed: 'A dated record of each child leaving, kept over time, so a model could learn how long the warning signs run before a child goes.',
    insteadAsk: 'Which children carry the most warning signs right now — the dropout risk score ranks exactly that, and it is an early warning rather than a date.',
    match: /when (will|would|is|are) .{0,40}?(drop|leave|quit)|predict when|how long before .{0,30}?(drop|leave)|time to dropout|drop ?out date/i,
  },
  {
    id: 'absence_reason',
    question: 'Why one particular child was absent.',
    missing: 'There is no reason-for-absence field anywhere in the data. Attendance records a percentage, never a cause, and no note is captured when a child misses class.',
    wouldNeed: 'A short reason code recorded alongside absence — illness, work, migration, cost — even as a single dropdown on the register.',
    insteadAsk: 'What is different about the children with low attendance — the system compares that group against everyone else and reports the real differences it finds.',
    match: /why (was|were|is|are) .{0,40}?absent|reason for absence|reason they (are |were )?absent|cause of absence/i,
  },
  {
    id: 'reading_assessment',
    question: 'A true reading level for a child.',
    missing: 'There is no reading assessment in this data. Reading is approximated by the language subjects, Bangla and English, which measure schoolwork in those subjects rather than reading fluency.',
    wouldNeed: 'A reading-specific assessment recorded per child — a fluency or level check separate from subject marks.',
    insteadAsk: 'How many children sit at each score level by area, using the language subjects as the closest available proxy.',
    match: /reading (fluency|ability|assessment|test)|can .{0,20}?read|true reading level/i,
  },
  {
    id: 'teacher_subject',
    question: 'Which teacher teaches which subject or child, in Real mode.',
    missing: 'The real data links a teacher to a CENTRE only. There is no teacher-to-subject and no teacher-to-student link anywhere in the export.',
    wouldNeed: 'A timetable or class-assignment record connecting each teacher to the subjects and batches they teach.',
    insteadAsk: 'Which centres have the weakest monitoring scores, and which subjects have the weakest marks — the two together point at where teaching support is needed.',
    match: /which teacher (teaches|taught|is responsible)|teacher (for|of) (the )?(subject|class|batch)|who teaches/i,
  },
  {
    id: 'individual_causes',
    question: 'Proof that one thing CAUSED another.',
    missing: 'This is observational programme data with no experiment and no control group behind it. Nothing in it can establish cause.',
    wouldNeed: 'A controlled comparison — the same intervention given to some centres and not others, tracked over time.',
    insteadAsk: 'What goes together with the outcome you care about. The factor analysis measures real differences between a group and the rest of the network, and is careful to call them associations.',
    match: /prove|proof|does .{0,30}? cause|causal|causation|caused by/i,
  },
];

/** The limit that matches a question, if any. */
export function findLimit(question: string): KnownLimit | null {
  return KNOWN_LIMITS.find((l) => l.match.test(question ?? '')) ?? null;
}

/* ────────────────────────── number verification ────────────────────────── */

/**
 * Every number the composed answer states must be traceable to the facts it was given.
 *
 * Small integers (0–10) are exempt: they are counts of listed things ("the four parts", "all five
 * indicators") rather than statistics, and rejecting them would throw away good answers constantly.
 * Anything larger, or anything with a decimal, is a figure — a percentage, a count, a year, a
 * weight — and inventing one of those is the failure this guards against.
 */
export function unsupportedNumbers(answer: string, facts: string): string[] {
  const nums = (s: string): number[] =>
    (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((t) => Number(t.replace(/,/g, ''))).filter((n) => Number.isFinite(n));
  const allowed = new Set(nums(facts));
  const bad: string[] = [];
  for (const n of nums(answer)) {
    if (Number.isInteger(n) && n >= 0 && n <= 10) continue;
    if (!allowed.has(n)) bad.push(String(n));
  }
  return [...new Set(bad)];
}

/* ────────────────────────── dataset facts ────────────────────────── */

const KEY_VIEWS = ['v_students', 'v_center_enrollment', 'v_student_attendance', 'v_marks', 'v_teachers'];

/** A compact, TRUE description of the active dataset: sizes, and how filled the columns that matter are. */
export function renderDatasetFacts(profile: DbProfile, question: string): string {
  const q = (question ?? '').toLowerCase();
  const wantsFields = /field|column|schema|structure|what.{0,20}(in|inside) (the|this|your)/i.test(q);

  const lines: string[] = [`ACTIVE DATASET: ${profile.dataMode === 'tuned' ? 'PREVIEW (estimated, watermarked, not for decisions)' : profile.dataMode === 'v2' ? 'REAL ·26 (the 14-Aug-2026 export)' : 'REAL (recorded data)'}`];

  lines.push('', 'HOW BIG IT IS:');
  for (const name of KEY_VIEWS) {
    const v = profile.views.find((x) => x.view === name);
    if (v && v.rows > 0) lines.push(`  - ${name}: ${v.rows.toLocaleString()} rows`);
  }

  // Coverage is the thing people are really asking about when they ask "how complete is it".
  lines.push('', 'HOW COMPLETE THE IMPORTANT COLUMNS ARE (share of rows that carry a real value):');
  const interesting: [string, string][] = [
    ['v_student_attendance', 'avg_attendance_recorded'],
    ['v_students', 'income_band'],
    ['v_students', 'programme'],
    ['v_students', 'student_name'],
    ['v_students', 'disability_type'],
    ['v_students', 'nutrition'],
    ['v_center_enrollment', 'me_score'],
    ['v_marks', 'mark'],
  ];
  for (const [view, col] of interesting) {
    const c = profile.views.find((x) => x.view === view)?.columns.find((x) => x.name === col);
    if (c) lines.push(`  - ${view}.${col}: ${c.filledPct}% filled`);
  }

  if (wantsFields) {
    lines.push('', 'WHAT IS RECORDED (the queryable views and their columns):');
    for (const v of VIEWS) {
      lines.push(`  - ${v.name} (${v.grain}): ${v.columns.map((c) => c.name).join(', ')}`);
    }
  } else {
    lines.push('', 'THE QUERYABLE VIEWS:', `  ${VIEWS.map((v) => v.name).join(', ')}`);
  }

  lines.push('', 'KNOWN DATA PROBLEMS (state these plainly, they are real):');
  for (const c of caveatsFor(CAVEATS, profile.dataMode)) lines.push(`  - ${c}`);

  lines.push('', 'WHAT THIS SYSTEM CANNOT ANSWER, AND WHY:');
  for (const l of KNOWN_LIMITS) {
    lines.push(`  - ${l.question}`, `      missing: ${l.missing}`, `      would need: ${l.wouldNeed}`);
  }

  lines.push('', 'EXAMPLES OF QUESTIONS THAT DO WORK (grouped by area):');
  for (const m of MODULES) {
    lines.push(`  - ${m.name}: ${m.questions.slice(0, 4).map((x) => `"${x.q}"`).join('; ')}`);
  }

  return lines.join('\n');
}

/* ────────────────────────── composition ────────────────────────── */

const COMPOSE_SYSTEM = [
  'You are explaining this system to a UNICEF field officer in Bangladesh. They are busy and practical, they have NO statistics training, and English may be their second language.',
  'They asked a question ABOUT THE DATA OR ABOUT WHAT A NUMBER MEANS — not for a calculation. Answer that question.',
  '',
  'ABSOLUTE RULES:',
  '- Use ONLY the FACTS below. Never add a fact, a figure, a field name or a claim that is not there.',
  '- NEVER invent a number. If a number is not in the FACTS, do not write it.',
  '- Do not produce statistics. You are explaining, not analysing. Never say what the data SHOWS.',
  '- If the FACTS do not answer part of the question, say plainly that it is not recorded — then say what IS available.',
  '- Never end on a dead end. Always finish with something the reader CAN ask or do.',
  '',
  'HOW TO WRITE:',
  '- Short sentences, 12-18 words. One idea per sentence.',
  '- Everyday words. If a 12-year-old would not know it, replace it.',
  '- Talk about children, families, teachers and centres — not about "metrics", "variables" or "fields", unless the reader asked about fields.',
  '- Use markdown bullets starting "* " for lists. Bold a term with **like this** the first time it appears.',
  '- Answer the ACTUAL question first, in one or two sentences, before any detail.',
  '- 120-220 words. Enough to be genuinely useful, short enough to read once.',
  '',
  'Reply with the answer text only. No JSON, no preamble, no headings.',
].join('\n');

/** Compose an answer from a facts block, then verify it invented nothing. Falls back on any doubt. */
async function compose(question: string, facts: string, fallback: string, generate: Generate): Promise<string> {
  try {
    const out = (await generate(COMPOSE_SYSTEM, `FACTS (the only things you may state):\n${facts}\n\nQUESTION: ${question}\n\nWrite the answer now.`)).trim();
    if (!out || out.length < 40) {
      aiLog('explain: composed answer too short — using the written definition');
      return fallback;
    }
    const bad = unsupportedNumbers(out, `${facts}\n${question}`);
    if (bad.length) {
      aiLog(`explain: composed answer invented number(s) ${bad.join(', ')} — using the written definition instead`);
      return fallback;
    }
    return out;
  } catch {
    return fallback;
  }
}

function result(question: string, summary: string): AskResult {
  return { question, intent: 'lookup', sql: null, refused: false, attempts: 1, response: { summary, widgets: [] }, explained: true };
}

/* ────────────────────────── provenance ────────────────────────── */

/** "Where did this number come from?" — asked without naming a term. */
const PROVENANCE =
  /where (does|do|did) .{0,40}(come|comes) from|what (is|are) (this|that|it|these) based on|how do you know|how did you (work|get|find|arrive|calculate)|which field|what field|what data is behind/i;

/** How a number actually reaches the screen. Every line here is true of the pipeline as built. */
const PROVENANCE_FACTS = [
  'HOW EVERY NUMBER IN AN ANSWER IS PRODUCED:',
  '- The AI never writes a number. It writes a database query; the query runs and returns real rows; those rows become the answer.',
  '- Queries run against the semantic views, not the raw files. The views hold the agreed business definitions, written once, so "active", "dropout", "attendance" and "monitoring score" mean the same thing in every answer.',
  '- The data is queried inside the browser. The spreadsheets are not sent anywhere.',
  '- The exact query behind any answer is shown on that answer, under Source.',
  '- The associated factors are measured in the database too, by comparing the exact group in the answer against everyone else. The AI describes them; it cannot add to them.',
  '- Preview mode fills gaps with estimated values and is marked as estimated. Real mode is recorded data only.',
  '- Where a field is thinly filled in, the answer says so rather than presenting the average as if it covered everyone.',
].join('\n');

const PROVENANCE_FALLBACK = [
  '**Every number here is read from your data, not written by the AI.**',
  '',
  '* The AI writes a database query. The query runs on your data and returns real rows.',
  '* Those rows become the answer. The AI describes them — it never makes a figure up.',
  '* Queries run against agreed definitions, so a word like "dropout" means the same thing every time.',
  '* You can see the exact query behind any answer under **Source** on that answer.',
  '* Your data is queried inside your browser. The spreadsheets are not sent anywhere.',
  '',
  'If an answer is in Preview mode, some values are estimated to fill gaps, and it is marked that way.',
].join('\n');

/* ────────────────────────── entry points ────────────────────────── */

/** CAPABILITY 1 — explain a metric, score, term or field. */
export async function answerDefinition(question: string, generate: Generate): Promise<AskResult> {
  const terms = findTerms(question);

  // A term we know: explain it, tailored to how they asked.
  if (terms.length) {
    const chosen = terms.slice(0, 2);
    const facts = renderTermFacts(chosen);
    const fallback = chosen.map(renderTermAnswer).join('\n\n---\n\n');
    aiLog(`explain: definition of ${chosen.map((t) => t.id).join(', ')}`);
    return result(question, await compose(question, facts, fallback, generate));
  }

  // A limit they have run into: explain the limit rather than dead-ending.
  const limit = findLimit(question);
  if (limit) return answerLimit(question, limit, generate);

  // "Where did this number come from?" with no term named — answer about the pipeline itself.
  if (PROVENANCE.test(question)) {
    aiLog('explain: provenance question');
    return result(question, await compose(question, PROVENANCE_FACTS, PROVENANCE_FALLBACK, generate));
  }

  // We genuinely do not have a definition. Say so, and say what we CAN define — never a dead end.
  const known = GLOSSARY.map((g) => g.term).join(', ');
  const facts = `THERE IS NO RECORDED DEFINITION FOR WHAT WAS ASKED.\nTERMS THAT CAN BE EXPLAINED: ${known}\nKNOWN DATA PROBLEMS:\n${CAVEATS.map((c) => '  - ' + c).join('\n')}`;
  const fallback = [
    "I don't have a definition for that one, so I would rather say so than guess.",
    '',
    'These are the terms I can explain exactly as the system calculates them:',
    '',
    ...GLOSSARY.map((g) => `* **${g.term}** — ${g.short}`),
  ].join('\n');
  return result(question, await compose(question, facts, fallback, generate));
}

/** A known limitation — what is missing, what would fix it, what to ask instead. */
export async function answerLimit(question: string, limit: KnownLimit, generate: Generate): Promise<AskResult> {
  aiLog(`explain: known limit "${limit.id}"`);
  const facts = [
    `THE USER IS ASKING ABOUT: ${limit.question}`,
    `THIS CANNOT BE ANSWERED. WHAT IS MISSING: ${limit.missing}`,
    `WHAT WOULD BE NEEDED TO ANSWER IT: ${limit.wouldNeed}`,
    `WHAT CAN BE ASKED INSTEAD, TODAY: ${limit.insteadAsk}`,
  ].join('\n');
  const fallback = [
    `**That one cannot be answered from this data — here is exactly why.**`,
    '',
    limit.missing,
    '',
    `**What would be needed:** ${limit.wouldNeed}`,
    '',
    `**What you can ask today:** ${limit.insteadAsk}`,
  ].join('\n');
  return result(question, await compose(question, facts, fallback, generate));
}

/** CAPABILITY 3 — questions about the dataset itself: shape, coverage, limits, what to ask. */
export async function answerDataset(question: string, dataSource: DataSource, dataMode: string, generate: Generate): Promise<AskResult> {
  // A limitation question has a specific, better answer than the general description.
  const limit = findLimit(question);
  if (limit) return answerLimit(question, limit, generate);

  // "why can't you …" with no matching limit still deserves the specific caveats, not a shrug.
  const profile = await getDbProfile(dataSource, dataMode);
  const facts = renderDatasetFacts(profile, question);
  aiLog(`explain: dataset question over ${profile.views.length} views`);

  const students = profile.views.find((v) => v.view === 'v_students')?.rows ?? 0;
  const centres = profile.views.find((v) => v.view === 'v_center_enrollment')?.rows ?? 0;
  const fallback = [
    `This dataset holds **${students.toLocaleString()} children** across **${centres.toLocaleString()} centres**.`,
    '',
    'You can ask about four areas:',
    ...MODULES.map((m) => `* **${m.name}** — ${m.short}`),
    '',
    'Things it genuinely cannot do:',
    ...KNOWN_LIMITS.slice(0, 3).map((l) => `* ${l.question} ${l.missing}`),
  ].join('\n');
  return result(question, await compose(question, facts, fallback, generate));
}

export type { GlossaryEntry };
