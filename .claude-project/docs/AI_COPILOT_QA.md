# AI Copilot — Product & Technical Q&A (Preview Briefing)

_Prepared 2026-07-31. A cheat-sheet for demoing the copilot to a technical manager. Answers are written
to be spoken. Numbers are from the real dataset and verified by the automated test suite._

---

## A. Product — what it is and why

**Q. In one sentence, what does this do?**
You ask a question about the education programme in plain English, and it answers with live charts and
numbers computed from the real 250,000-student dataset — no analyst, no pre-built report.

**Q. Who is it for and what problem does it solve?**
Programme managers and field officers who today wait on an analyst to pull numbers. It turns "which
centres need support?" or "why are students dropping out?" into an instant, data-backed answer.

**Q. How is this different from a normal BI dashboard (Power BI, Tableau)?**
Those need someone to pre-build every chart. Here the *user* asks anything in natural language and the
system writes the query itself. The fixed dashboards still exist; the copilot handles the long tail of
ad-hoc questions.

**Q. Isn't this just ChatGPT with our data pasted in?**
No. We never paste data into the model. The model only sees the *schema* (table/column descriptions) and
writes a SQL query; the query runs on our own engine over the real data. The model does the *translating
and interpreting*, not the data crunching. That's what keeps it accurate and private.

**Q. What's the "wow" in the demo?**
Type a question you never pre-built — e.g. "compare the three programmes on attendance and dropout" —
and watch it produce the right chart in seconds, then ask a follow-up like "now just Dhaka" and it
remembers context.

---

## B. Architecture — how it works

**Q. Walk me through what happens when I ask a question.**
1. We build a prompt = the **schema catalog** + **rules** + a few **worked examples** + your question.
2. **Gemini writes a SQL query** as JSON (`intent`, `sql`, `title`).
3. A **safety gate** validates it — must be a single read-only `SELECT` against our approved views only.
4. The SQL runs in **DuckDB** (a real SQL engine running *inside the browser*) over the CSV data.
5. If the SQL errors, it **self-corrects** once and retries.
6. The result rows are turned into **widgets** (chart/table/metrics) deterministically — every number
   on screen came from the query result.

**Q. This is "text-to-SQL" then?**
Exactly. It's the industry-standard pattern for trustworthy analytics AI. The model's only job is to
translate language → SQL and then narrate the result; the actual numbers come from SQL, not the model.

**Q. What's the "semantic layer"?**
A set of ~9 curated SQL **views** (e.g. `v_students`, `v_center_enrollment`, `v_attendance_monthly`)
that encode the correct business definitions once — what "active", "dropout", "recorded attendance"
mean. The model queries these views, not raw tables, so definitions stay consistent and correct.

**Q. Where does the compute run? Is there a backend?**
Today, **no backend** — the SQL engine (DuckDB-wasm) and the data run entirely in the browser. The only
external call is to the Gemini API to write the SQL. It deploys as a pure static site.

**Q. Why no backend?**
For this phase it's simpler, cheaper, fully private (data never leaves the machine), and it proves the
approach. The data access is behind a swappable `DataSource` interface, so we can move the exact same SQL
to a real backend database later **without rewriting the AI pipeline**.

**Q. What's the tech stack?**
React + TypeScript + Vite frontend; DuckDB-wasm for in-browser SQL; Gemini (with OpenAI as optional
fallback) for the language model; Recharts for visualisation.

---

## C. Data — sources, gaps, Real vs Preview

**Q. What data is in here and how much?**
The real NFPE programme data: **250,617 students**, plus attendance, ~1.7M assessment marks, teachers,
and centres. Five core tables.

**Q. Is this real data or fake?**
Real. The numbers you see in **Real mode** are the actual records.

**Q. Then what is "Preview mode"?**
The real data has big gaps — e.g. ~83% of attendance rows are blank, only ~30% of students have marks.
With gaps that large, whole dashboards look empty. **Preview** starts from the real data, **keeps every
real value untouched**, and fills *only the blanks* with realistic estimates sampled from the real
distributions — so every dashboard is fully populated for a demo.

**Q. Critical question: does Preview change any real numbers?**
No — and this is the design guarantee. Anything that exists in Real is **byte-for-byte identical** in
Preview. Only blanks are filled. Verified by the test suite: poverty dropouts = **64,133**, mainstreamed
= **209,606**, total = **250,617** — identical in both modes. Only *previously empty* fields differ.

**Q. Give me a concrete before/after.**
Attendance average: Real **14.5%** (because most rows are unrecorded zeros) → Preview **86.7%** (blanks
filled from the real recorded distribution). Marks: **391,270** real → **1,773,089** in Preview. The
real records inside those are unchanged.

**Q. Is Preview safe to make decisions on?**
No, and it says so — it carries a permanent "⚠️ Preview — estimated, not for decisions" banner. It's a
demonstration/what-if aid. Real mode is the source of truth.

**Q. How is the imputation done — is it random?**
It's **deterministic** (seeded) and driven by the *real* distributions, so it's reproducible and mirrors
real shapes. E.g. a blank attendance month is filled by sampling from actual recorded attendance for that
programme; a missing mark from the real programme×subject mark distribution.

**Q. The monthly attendance chart — where does that come from?**
The source only stores one aggregate attendance % per student — there's no month column, so month-by-
month genuinely doesn't exist. In **Preview** we synthesise a 12-month curve by spreading each
division×programme's real average over a seasonal pattern (monsoon dip). In **Real** it's honestly empty —
we do not fabricate a trend there.

**Q. What are the known data-quality issues?**
Attendance ~83% blank; assessments ~30% coverage; a mainstream/dropout contradiction in the raw data;
teacher division doesn't always align with student division; some centres lack names/GPS. The copilot
**states these caveats in its answers** rather than hiding them.

---

## D. AI / LLM specifics

**Q. Which model, and why?**
Google **Gemini Flash** — fast and free-tier friendly for this phase. The model choice is swappable via
config; OpenAI is wired as a fallback.

**Q. What if the API is rate-limited or down?**
We run **two Gemini keys in round-robin** (alternating per request ≈ doubles throughput) with automatic
**failover** — if one key hits a 429, it cools down and the other serves. If both are down and an OpenAI
key is configured, it takes over. If everything fails, the user gets an honest "try again" message, not
a wrong answer.

**Q. Can the model hallucinate a number?**
The *displayed numbers* can't be hallucinated — they come from the SQL result, not the model. The model
can write a *wrong query* (asking the wrong question), which is why we have the semantic layer,
worked examples, the safety gate, self-correction, and an eval suite to keep query accuracy high.

**Q. Does our data get used to train the model?**
No data rows are sent — only schema descriptions. And under the standard API terms, API data isn't used
for training. If needed we can move to an enterprise/no-retention tier or a self-hosted model.

**Q. How do you stop it running a dangerous query?**
The safety gate rejects anything that isn't a single read-only `SELECT`, blocks all write/DDL keywords
(DROP, DELETE, etc.), and allows only our whitelisted views — never raw tables. Plus the engine is
read-only and local. Verified by tests.

---

## E. Accuracy & trust

**Q. How accurate is it?**
Our live accuracy eval runs 12 known-answer questions through the real pipeline and currently scores
**12/12**. The deterministic backbone (validate → run → render) is covered by a **26-check** suite that
passes on both datasets.

**Q. How do you know the answers are right, not just plausible?**
Two layers: (1) numbers are computed by SQL we can read and re-run by hand; (2) the eval harness compares
the model's live answers against pre-verified correct values. If a query is wrong, the eval catches it.

**Q. What happens when it can't answer something?**
It refuses honestly and suggests answerable alternatives — e.g. asked for a breakdown the data doesn't
support, it says so instead of inventing a chart. You saw this with "month by month" in Real mode.

**Q. Can I see the query it wrote?**
Yes — a debug mode logs the exact SQL, the model that served it, token cost, and timing in the console.

---

## F. Security & privacy

**Q. Where does the sensitive data go?**
Nowhere external. Data stays in the browser/local machine. Only the natural-language question + schema go
to the model API. Student names, income, and GPS are never transmitted.

**Q. Is the data committed to the repo?**
No. All real data files are **git-ignored** and never published. The app is currently private/local.

**Q. What about the API keys?**
In a git-ignored `.env`. For production we'd move key handling to a backend so keys aren't in the client.

---

## G. Cost & scale

**Q. What does it cost to run?**
Currently near-zero — Gemini free tier plus static hosting. Cost per question is a single small LLM call
(a few hundred tokens of schema + the question). No per-user infrastructure.

**Q. Does it scale to more data / more users?**
The in-browser engine comfortably handles the current 250k rows. For much larger data or many concurrent
users, we flip the `DataSource` to a real backend database — the AI pipeline is unchanged. That's the
planned path to production.

**Q. How fast is a query?**
Typically a couple of seconds end-to-end — dominated by the LLM writing the SQL; the SQL itself runs in
milliseconds.

---

## H. Testing & QA

**Q. How is this tested?**
- `npm run e2e` — free, no-token backbone test across **both** Real and Preview: 26 checks (views build,
  6 query shapes render, safety gate blocks bad SQL, and cross-mode invariants hold). Currently **26/26**.
- `npm run eval` — live LLM accuracy on 12 known questions (**12/12**).
- `npm run verify:sql` — runs the semantic views directly to sanity-check the SQL layer.

**Q. Is it CI-ready?**
Yes — `e2e` exits non-zero on any failure and spends no tokens, so it can gate every change.

**Q. How do you prove Preview didn't corrupt real data?**
The e2e suite asserts the invariants automatically (poverty dropouts, mainstream count, totals identical
across modes). If an imputation ever touched a real value, that test fails.

---

## I. Limitations (be upfront)

- **Preview values are estimates** — demo only, never decisions.
- **Monthly attendance is Preview-only** and synthetic; Real has no monthly granularity at source.
- **Query accuracy depends on the model** — rare complex questions can produce a wrong query; the eval
  suite is how we catch and fix those (by adding examples/rules).
- **No backend yet** — keys live client-side; fine for private/local, must change for public production.
- **Free-tier limits** — heavy usage can rate-limit; mitigated by dual keys + failover.
- **Source data gaps** are real — the copilot surfaces them honestly but can't invent missing measurements
  in Real mode.

---

## J. Roadmap / "can we productionise this?"

**Q. What would it take to go to production?**
1. Move data + SQL to a backend database (swap the `DataSource` — pipeline unchanged).
2. Move LLM calls + API keys server-side (secure keys, add per-user auth).
3. Add caching for repeated questions to cut cost/latency.
4. Expand the eval set and add monitoring on query accuracy.

**Q. What's the biggest risk?**
Model query accuracy on unusual questions. Mitigation is well-understood: grow the few-shot examples and
semantic layer, and let the eval harness measure every change.

**Q. What's genuinely impressive here technically?**
A full text-to-SQL analytics engine running with **no backend**, on **real 250k-row data**, fully private,
with a swappable dual-mode dataset and an automated test suite proving both accuracy and that the demo
data never corrupts real values.

---

## K. Quick-fire numbers to have ready

| Metric | Value |
|---|---|
| Students | 250,617 |
| Poverty dropouts (Real = Preview) | 64,133 |
| Mainstreamed (Real = Preview) | 209,606 |
| Attendance avg — Real → Preview | 14.5% → 86.7% |
| Assessment marks — Real → Preview | 391,270 → 1,773,089 |
| Queryable semantic views | ~9 |
| e2e backbone checks | 26/26 pass |
| Live accuracy eval | 12/12 pass |
| LLM providers | 2× Gemini (round-robin + failover) + optional OpenAI |
