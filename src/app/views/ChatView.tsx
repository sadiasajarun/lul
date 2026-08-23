import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  Bot, Sparkles, Target, Award, AlertTriangle, Compass, ShieldCheck, Info,
  Check, Copy, ChevronRight, Zap,
  Share2, RotateCcw, MoreHorizontal, Printer, Table2, Volume2, X, Database, FileText,
  GraduationCap, Users, Activity, GitCompare, ShieldAlert,
  CalendarCheck, Building2, ClipboardList, ArrowLeft, HelpCircle,
} from "lucide-react";

/** Quick prompts shown on the empty "What dashboard can I generate?" screen — click to generate. */
/** Quick prompts; `mode: "preview"` cards only show in Preview mode (they rely on simulated data). */
const QUICK_PROMPTS: { icon: typeof Target; color: string; q: string; mode?: "preview" }[] = [
  { icon: ClipboardList, color: "var(--oo-warning)", q: "What's the weakest monitoring indicator right now?" },
  { icon: Target, color: "var(--oo-danger)", q: "Show students at risk of dropping out" },
  { icon: Building2, color: "var(--oo-primary)", q: "Which centres need a visit?" },
  { icon: Target, color: "var(--oo-danger)", q: "Show dropout risk — the highest-risk students" },
  { icon: AlertTriangle, color: "var(--oo-danger)", q: "Which centers have the lowest score?" },
  { icon: Database, color: "var(--oo-info)", q: "Which centers' data is too incomplete to trust?" },
  { icon: Award, color: "var(--oo-warning)", q: "Which subjects have the weakest average marks?" },
  { icon: Users, color: "var(--band-green)", q: "Show the lowest-income students" },
  { icon: Activity, color: "var(--oo-warning)", q: "Show attendance trend month by month", mode: "preview" },
  { icon: Compass, color: "var(--oo-muted)", q: "Show ghost / inactive students", mode: "preview" },
  { icon: ShieldAlert, color: "var(--oo-danger)", q: "Show dropout reasons for ABAL program" },
  { icon: GraduationCap, color: "var(--oo-info)", q: "Analyze teacher education levels" },
  { icon: GitCompare, color: "var(--oo-primary)", q: "Compare program enrollment & mainstreaming" },
];
import type { ChatMsg, Lens } from "../lib/types";
import { LENS_STYLE } from "../utils/chatMeta";
import { bumpUsage, getUsage } from "../utils/learningStore";
import { getDataMode } from "../lib/db";
import { MessageWidgets } from "../components/dash/MessageWidgets";
import { toBnNumerals, type Lang } from "../lib/fmt";
import { messageToMarkdown, messageToCsv, messageToHtml, download, printHtml, speak, stripMd } from "../utils/chatExport";
import { SharePopup } from "../components/copilot/SharePopup";
import { MODULES, CHIP_LABEL, type ModuleId, type QuestionChip } from "../lib/modules";
import type { AnswerReasoning } from "../lib/ai/reasoning";
import { findTerms } from "../lib/ai/glossary";
import type { FactorComparison } from "../lib/ai/factors";

/**
 * The RAG-aware conversation surface (design brief). Every AI answer renders as:
 * decision lens + severity accent · grounded/withheld trust signal · attached widget(s) ·
 * coverage caption · follow-up chips. Four states are handled: grounded, withheld, refuse, cached.
 */

const LENS_ICON: Record<LensStyle["icon"], typeof Target> = {
  target: Target, trophy: Award, alert: AlertTriangle, compass: Compass, shield: ShieldCheck, info: Info,
};
type LensStyle = (typeof LENS_STYLE)[Lens];

const STR = {
  en: {
    greet: "What can I generate for you?",
    genSub: "Describe what you want to see — I'll generate a live dashboard from your data. Type a prompt below.",
    generating: "Generating your dashboard…",
    sub: "Your AI teaching assistant. Ask about your students, learning, centres or teachers — I answer with grounded numbers, a focused chart, what it means, and what to do next.",
    tryLabel: "Try a micro-question",
    grounded: "Grounded",
    cached: "Instant · cached",
    withheld: "Some figures in the model's wording couldn't be verified against the data, so it was replaced with a summary generated directly from the returned data below.",
    localFallback: "Answered by the local engine — the AI provider request failed, so this may be less precise than a full RAG answer. Check the question is answerable from this dataset.",
    refuseTitle: "I can't answer that from this data.",
    refuseBody: "No fabricated widget was returned. Try one of these instead:",
    copy: "Copy", copied: "Copied",
  },
  bn: {
    greet: "আমি আপনার জন্য কী তৈরি করতে পারি?",
    genSub: "আপনি যা দেখতে চান বর্ণনা করুন — আমি আপনার ডেটা থেকে একটি লাইভ ড্যাশবোর্ড তৈরি করব। নিচে একটি প্রম্পট লিখুন।",
    generating: "আপনার ড্যাশবোর্ড তৈরি হচ্ছে…",
    sub: "আপনার এআই শিক্ষা সহকারী। শিক্ষার্থী, শিখন, কেন্দ্র বা শিক্ষক সম্পর্কে জিজ্ঞাসা করুন — আমি তথ্যভিত্তিক সংখ্যা, চার্ট, অর্থ ও পরবর্তী করণীয় দিয়ে উত্তর দেব।",
    tryLabel: "একটি ছোট প্রশ্ন করে দেখুন",
    grounded: "তথ্যভিত্তিক",
    cached: "তাৎক্ষণিক · ক্যাশড",
    withheld: "মডেলের কিছু সংখ্যা তথ্যের সাথে যাচাই করা যায়নি, তাই এর বদলে নিচের ফেরত আসা ডেটা থেকে সরাসরি একটি সারসংক্ষেপ তৈরি করা হয়েছে।",
    localFallback: "স্থানীয় ইঞ্জিন দিয়ে উত্তর দেওয়া হয়েছে — এআই প্রোভাইডারের অনুরোধ ব্যর্থ হয়েছে, তাই এটি কম নির্ভুল হতে পারে। প্রশ্নটি এই ডেটাসেট থেকে উত্তরযোগ্য কিনা দেখে নিন।",
    refuseTitle: "এই তথ্য থেকে আমি এর উত্তর দিতে পারছি না।",
    refuseBody: "কোনো বানানো উইজেট দেখানো হয়নি। বরং এগুলোর একটি চেষ্টা করুন:",
    copy: "কপি", copied: "কপি হয়েছে",
  },
} as const;

/** Render grounded markdown bullets (the summary is 1–4 `* **bold** rest` lines). */
function Bullets({ text, lang }: { text: string; lang: Lang }) {
  const render = (s: string) => (lang === "bn" ? toBnNumerals(s) : s);
  const lines = text.split("\n").map((l) => l.replace(/^\*\s*/, "").trim()).filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const bold = line.match(/^\*\*(.*?)\*\*(.*)/);
        return (
          <div key={i} className="flex gap-2 items-start text-[13px] leading-relaxed text-[var(--oo-heading)]">
            <span className="mt-0.5 shrink-0" style={{ color: "var(--oo-primary)" }}>•</span>
            <span>
              {bold ? (<><strong>{render(bold[1])}</strong>{render(bold[2])}</>) : render(line)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LensChip({ lens, lang }: { lens: Lens; lang: Lang }) {
  const style = LENS_STYLE[lens];
  const Icon = LENS_ICON[style.icon];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md"
      style={{ color: style.color, background: `color-mix(in srgb, ${style.color} 12%, transparent)` }}
    >
      <Icon size={11} />
      {lang === "bn" ? style.labelBn : style.label}
    </span>
  );
}

function ActBtn({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--oo-muted)] hover:text-[var(--oo-primary)] hover:bg-[var(--oo-canvas)] transition-colors cursor-pointer"
    >
      {children}
    </button>
  );
}
function MenuItem({ icon: Icon, label, onClick }: { icon: typeof FileText; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-[var(--oo-text)] hover:bg-[var(--oo-canvas)] transition-colors cursor-pointer"
    >
      <Icon size={13} className="text-[var(--oo-muted)] shrink-0" />
      {label}
    </button>
  );
}

function SourcePopover({ msg, onClose }: { msg: ChatMsg; onClose: () => void }) {
  const facts = msg.facts ?? [];
  const sources = msg.sources ?? [];
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md p-5"
        style={{ borderRadius: "var(--oo-card-radius)", boxShadow: "var(--oo-card-shadow)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Database size={15} className="text-[var(--oo-primary)]" />
            <h3 className="font-head text-[15px] font-semibold text-[var(--oo-heading)]">Data sources</h3>
          </div>
          <button onClick={onClose} className="text-[var(--oo-muted)] hover:text-[var(--oo-heading)] cursor-pointer" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {sources.length ? (
          <>
            <div className="text-[11px] text-[var(--oo-muted)] mb-2">
              Grounded in {sources.length} dataset source{sources.length > 1 ? "s" : ""}:
            </div>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {sources.map((s) => (
                <span key={s} className="text-[11px] font-mono bg-[var(--oo-canvas)] border border-[var(--oo-border)] rounded px-2 py-1 text-[var(--oo-heading)]">
                  {s}
                </span>
              ))}
            </div>
            {facts.length > 0 && (
              <>
                <div className="text-[10px] font-bold text-[var(--oo-muted)] uppercase tracking-wider mb-2">Facts used</div>
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {facts.map((f, i) => (
                    <div key={i} className="text-[12px] text-[var(--oo-text)] leading-snug border-l-2 pl-2.5" style={{ borderColor: "color-mix(in srgb, var(--oo-primary) 40%, transparent)" }}>
                      <div>{f.statement}</div>
                      <div className="text-[10px] font-mono text-[var(--oo-muted)] mt-0.5">{f.source}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="text-[12px] text-[var(--oo-text)] leading-relaxed">
            This answer was computed directly over the dataset (no fact-pack retrieval recorded). Every number is still
            verified against <code>Database/</code>.
          </div>
        )}
      </div>
    </div>
  );
}

function MessageActions({ msg, index, lang, onRegenerate }: { msg: ChatMsg; index: number; lang: Lang; onRegenerate: (i: number) => void }) {
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const [share, setShare] = useState(false);
  const [source, setSource] = useState(false);
  const t = STR[lang];

  const doCopy = () => {
    try {
      navigator.clipboard?.writeText(stripMd(msg.text));
    } catch {
      /* clipboard unavailable */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative flex items-center gap-0.5 mt-2">
      <ActBtn onClick={doCopy} title={t.copy}>
        {copied ? <Check size={14} className="text-[var(--oo-success)]" /> : <Copy size={14} />}
      </ActBtn>
      <ActBtn onClick={() => setShare(true)} title="Share">
        <Share2 size={14} />
      </ActBtn>
      <ActBtn onClick={() => onRegenerate(index)} title="Regenerate">
        <RotateCcw size={14} />
      </ActBtn>
      <div className="relative">
        <ActBtn onClick={() => setMenu((o) => !o)} title="More">
          <MoreHorizontal size={15} />
        </ActBtn>
        {menu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
            <div className="absolute right-0 top-8 z-50 w-52 bg-white border border-[var(--oo-border)] rounded-lg shadow-lg py-1">
              <div className="px-3 py-1.5 text-[10px] font-bold text-[var(--oo-muted)] uppercase tracking-wider">Download output</div>
              <MenuItem icon={Printer} label="As PDF" onClick={() => { printHtml(messageToHtml(msg), "Answer"); setMenu(false); }} />
              <MenuItem icon={Table2} label="As Excel (CSV)" onClick={() => { download("answer.csv", messageToCsv(msg), "text/csv"); setMenu(false); }} />
              <MenuItem icon={FileText} label="As Markdown" onClick={() => { download("answer.md", messageToMarkdown(msg), "text/markdown"); setMenu(false); }} />
              <div className="my-1 border-t border-[var(--oo-border)]" />
              <MenuItem icon={Volume2} label="Read aloud" onClick={() => { speak(msg.text); setMenu(false); }} />
              <MenuItem icon={Database} label="Source" onClick={() => { setSource(true); setMenu(false); }} />
            </div>
          </>
        )}
      </div>
      <span className="text-[10px] text-[var(--oo-muted)] font-mono ml-1">{msg.timestamp}</span>

      {share && (
        <SharePopup
          url={`${location.origin}/shared/answer/${index}`}
          title="Share this answer"
          preview={stripMd(msg.text).slice(0, 240)}
          shareText={messageToMarkdown(msg)}
          onClose={() => setShare(false)}
        />
      )}
      {source && <SourcePopover msg={msg} onClose={() => setSource(false)} />}
    </div>
  );
}

function ModuleIcon({ id, size }: { id: ModuleId; size: number }) {
  const Icon = id === "attendance" ? CalendarCheck : id === "centres" ? Building2 : id === "assessment" ? ClipboardList : Users;
  return <Icon size={size} />;
}

function QChip({ chip }: { chip: QuestionChip }) {
  const c = CHIP_LABEL[chip];
  return (
    <span
      className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap"
      style={{ background: c.bg, color: c.fg }}
    >
      {c.text}
    </span>
  );
}

/**
 * The opening screen (design Option B): the four decision areas as cards → pick one → its
 * questions → the answer. Quick prompts stay available but are secondary, trimmed to the handful
 * people actually re-run. Preview-only questions are hidden in Real mode, as the quick prompts are.
 */
function EmptyState({ lang, onAsk }: { lang: Lang; onAsk: (q: string) => void }) {
  const bn = lang === "bn";
  const mode = getDataMode();
  const usage = getUsage();
  const [openId, setOpenId] = useState<ModuleId | null>(null);

  const visible = (m: (typeof MODULES)[number]) => m.questions.filter((q) => !q.mode || mode === "tuned");
  const open = MODULES.find((m) => m.id === openId) ?? null;

  // Quick prompts are now the short list: the most-used, and only those not already in a module.
  const inModules = new Set(MODULES.flatMap((m) => m.questions.map((q) => q.q)));
  const quick = [...QUICK_PROMPTS]
    .filter((c) => (!c.mode || mode === "tuned") && !inModules.has(c.q))
    .sort((a, b) => (usage[b.q] ?? 0) - (usage[a.q] ?? 0))
    .slice(0, 4);

  const ask = (q: string) => { bumpUsage(q); onAsk(q); };

  return (
    <div className="min-h-full flex gap-6 py-8 px-1">
      {/* ── main canvas ─────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 max-w-3xl mx-auto">
        {!open ? (
          <>
            <div className="flex flex-col items-center text-center">
              <div
                className="w-16 h-16 rounded-2xl mb-5 flex items-center justify-center text-white"
                style={{ background: "linear-gradient(140deg, var(--oo-primary), #8f78f0)", boxShadow: "0 12px 30px -8px color-mix(in srgb, var(--oo-primary) 55%, transparent)" }}
              >
                <Bot size={30} />
              </div>
              <h1 className="font-head text-[24px] font-bold text-[var(--oo-heading)] tracking-tight mb-2.5">
                {bn ? "আপনি কী সিদ্ধান্ত নিতে চান?" : "What do you need to decide?"}
              </h1>
              <p className="text-[13.5px] text-[var(--oo-muted)] max-w-md leading-relaxed">
                {bn
                  ? "একটি ক্ষেত্র বেছে নিন — এটি কোন প্রশ্নের উত্তর দিতে পারে দেখুন। অথবা যেকোনো সময় নিজের প্রশ্ন লিখুন।"
                  : "Choose an area to see the questions it can answer — or type your own question at any time."}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-8">
              {MODULES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setOpenId(m.id)}
                  data-testid={`chat-module-${m.id}`}
                  className="text-left bg-white border border-[var(--oo-border)] rounded-2xl p-5 hover:shadow-md transition-all cursor-pointer group"
                  style={{ boxShadow: "var(--oo-card-shadow)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = m.ink)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "")}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: m.tint, color: m.ink }}>
                      <ModuleIcon id={m.id} size={19} />
                    </span>
                    <span className="font-head text-[15.5px] font-bold text-[var(--oo-heading)] tracking-tight">
                      {bn ? m.nameBn : m.name}
                    </span>
                  </div>
                  <p className="text-[12.5px] text-[var(--oo-muted)] leading-relaxed mt-3">{bn ? m.whyBn : m.why}</p>
                  <div className="flex items-center gap-2 mt-3.5 pt-3 border-t border-[var(--oo-border)] text-[11.5px] font-semibold" style={{ color: m.ink }}>
                    {bn ? "প্রশ্ন দেখুন" : "Explore"}
                    <span className="ml-auto text-[11px] font-medium text-[var(--oo-muted)]">
                      {visible(m).length} {bn ? "টি প্রশ্ন" : "questions"}
                    </span>
                    <ChevronRight size={13} />
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* module tabs — switch area without going back */}
            <div className="flex flex-wrap gap-2 mb-5">
              <button
                onClick={() => setOpenId(null)}
                data-testid="chat-module-back"
                className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--oo-text)] bg-white border border-[var(--oo-border)] rounded-xl px-3 py-2 hover:border-[var(--oo-primary)] hover:text-[var(--oo-primary)] transition-colors cursor-pointer"
              >
                <ArrowLeft size={13} />
                {bn ? "সব ক্ষেত্র" : "All areas"}
              </button>
              {MODULES.map((m) => {
                const on = m.id === openId;
                return (
                  <button
                    key={m.id}
                    onClick={() => setOpenId(m.id)}
                    aria-selected={on}
                    data-testid={`chat-tab-${m.id}`}
                    className="flex items-center gap-2 text-[12.5px] font-semibold rounded-xl px-3 py-2 border transition-colors cursor-pointer"
                    style={on
                      ? { background: m.ink, borderColor: m.ink, color: "#fff" }
                      : { background: "#fff", borderColor: "var(--oo-border)", color: "var(--oo-text)" }}
                  >
                    <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                      style={on ? { background: "rgba(255,255,255,.22)", color: "#fff" } : { background: m.tint, color: m.ink }}>
                      <ModuleIcon id={m.id} size={12} />
                    </span>
                    {bn ? m.nameBn : m.name}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3 mb-4">
              <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: open.tint, color: open.ink }}>
                <ModuleIcon id={open.id} size={19} />
              </span>
              <div>
                <h2 className="font-head text-[18px] font-bold text-[var(--oo-heading)] tracking-tight">{bn ? open.nameBn : open.name}</h2>
                <p className="text-[12.5px] text-[var(--oo-muted)]">{bn ? open.shortBn : open.short}</p>
              </div>
            </div>

            <div className="grid gap-2">
              {visible(open).map((q, i) => (
                <button
                  key={q.q}
                  onClick={() => ask(q.q)}
                  data-testid={`chat-question-${open.id}-${i}`}
                  className="flex items-center gap-3 text-left bg-white border border-[var(--oo-border)] rounded-xl px-4 py-3.5 hover:shadow-sm transition-all cursor-pointer group"
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = open.ink)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "")}
                >
                  <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-bold"
                    style={{ background: open.tint, color: open.ink }}>
                    {i + 1}
                  </span>
                  <span className="text-[13.5px] text-[var(--oo-heading)] font-medium leading-snug">{q.q}</span>
                  {q.chip && <QChip chip={q.chip} />}
                  {q.previewOnly && mode !== "tuned" && (
                    <span
                      className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap"
                      style={{ background: "#FFF1E3", color: "#B4661F" }}
                      title="Real mode has no dated attendance, so this returns an explanation rather than a forecast."
                    >
                      {bn ? "শুধু প্রিভিউ" : "Preview only"}
                    </span>
                  )}
                  <ChevronRight size={14} className="ml-auto text-[#c6cbe8] shrink-0" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── quick prompts — secondary, on the side ───────────────── */}
      {quick.length > 0 && (
        <aside className="hidden xl:block w-[210px] shrink-0">
          <div className="text-[10px] font-bold text-[var(--oo-muted)] uppercase tracking-widest mb-2.5">
            {bn ? "দ্রুত প্রম্পট" : "Quick prompts"}
          </div>
          <div className="grid gap-1">
            {quick.map(({ q }) => (
              <button
                key={q}
                onClick={() => ask(q)}
                className="flex items-start gap-2.5 text-left text-[12.5px] text-[var(--oo-text)] rounded-lg px-2.5 py-2 hover:bg-white hover:text-[var(--oo-primary)] transition-colors cursor-pointer leading-snug"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--oo-primary)] opacity-50 shrink-0 mt-[7px]" />
                {q}
              </button>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}

/**
 * The four-layer answer. The order is the point: what the data shows → which factors are associated
 * (quantified, ranked, computed in SQL) → how confident we are → what to do next. Confidence is a
 * qualifier placed BEFORE the action, never the closing note — the answer always ends on a step.
 */
function ReasoningPanel({ reasoning, lang }: { reasoning: AnswerReasoning; lang: Lang }) {
  const bn = lang === "bn";
  const { factors, protective, confidence, action, interpretation, noDriverNote, intent } = reasoning;
  // Factors the user asked for by name that turned out NOT to differ. Shown deliberately: "you asked,
  // and it makes no difference here" is a real answer, and dropping it looks like the request was
  // ignored. The ones that DO differ are already ranked in `factors` above.
  const askedFor = (reasoning.requested ?? []).filter((f) => !f.material);
  const conf = confidence.level;
  const confColor = conf === "high" ? "var(--oo-success)" : conf === "moderate" ? "var(--oo-warning)" : "var(--oo-muted)";
  const confLabel = conf === "high" ? (bn ? "উচ্চ" : "High") : conf === "moderate" ? (bn ? "মাঝারি" : "Moderate") : (bn ? "নিম্ন" : "Low");

  // Say the number in words a person reads once: "83 in every 100 children here" beats "82.6%".
  const inHundred = (pct: number) => Math.round(pct);
  const howMuch = (ratio: number) => {
    if (ratio >= 2) return bn ? "দ্বিগুণেরও বেশি" : "more than twice as common as usual";
    if (ratio >= 1.5) return bn ? "অনেক বেশি" : "about " + ratio.toFixed(1) + " times as common as usual";
    if (ratio >= 1.15) return bn ? "বেশি" : "clearly more common than usual";
    if (ratio <= 0.5) return bn ? "অনেক কম" : "less than half as common as usual";
    if (ratio <= 0.85) return bn ? "কম" : "less common than usual";
    return bn ? "প্রায় একই" : "close to usual";
  };

  const factorRow = (f: FactorComparison, i: number, muted = false) => {
    const isScore = f.unit === "score";
    // Scores are 0–5; shares read better as "x in every 100".
    const line = isScore
      ? `They score ${f.cohortValue.toFixed(1)} out of 5. Other ${f.family === "socioeconomic" ? "places" : "centres"} average ${f.baselineValue.toFixed(1)}.`
      : `${inHundred(f.cohortValue)} in every 100 here — against ${inHundred(f.baselineValue)} in every 100 across the whole programme.`;
    return (
      <li key={f.id} className="flex gap-3">
        <span
          className="w-5 h-5 rounded-md shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5"
          style={muted
            ? { background: "color-mix(in srgb, var(--oo-info) 12%, transparent)", color: "var(--oo-info)" }
            : { background: "color-mix(in srgb, var(--oo-primary) 11%, transparent)", color: "var(--oo-primary)" }}
        >
          {muted ? (f.material ? "✓" : "=") : i + 1}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-[var(--oo-heading)] leading-snug">{f.plainLabel}</div>
          <div className="text-[12.5px] text-[var(--oo-text)] leading-relaxed mt-0.5">{line}</div>
          <div className="text-[11.5px] mt-1" style={{ color: muted ? "var(--oo-info)" : "var(--oo-danger)" }}>
            {muted
              ? f.material
                ? (bn ? "স্বাভাবিকের চেয়ে ভালো" : "Better than usual here")
                : (bn ? "অন্য সবার মতোই" : "About the same as everywhere else")
              : howMuch(f.ratio)}
          </div>
          <div className="text-[10.5px] text-[var(--oo-muted)] mt-1">
            {bn ? "ভিত্তি: " : "Based on "}{f.cohortN.toLocaleString()}{" "}
            {f.cohortN === 1 ? (bn ? "টি রেকর্ড" : "record") : (bn ? "টি রেকর্ড" : "records")}
            {f.coveragePct < 90 ? (bn ? ` · ${f.coveragePct}% এর তথ্য আছে` : ` · information available for ${f.coveragePct}% of them`) : ""}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="max-w-4xl mb-4 space-y-3">
      {/* A factor the user asked for that turned out to make no difference. Answered, not dropped. */}
      {askedFor.length > 0 && (
        <div className="rounded-xl border border-[var(--oo-border)] bg-white p-4" style={{ boxShadow: "var(--oo-card-shadow)" }}>
          <div className="flex items-center gap-1.5 mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--oo-heading)]">
            <HelpCircle size={12} className="text-[var(--oo-info)]" />
            {bn ? "আপনি যেটি যোগ করতে বলেছিলেন" : "What you asked me to add"}
          </div>
          <div className="text-[11px] text-[var(--oo-muted)] mb-3 leading-snug">
            {bn
              ? "আমি এটি মেপে দেখেছি। এই দলের সাথে বাকিদের পার্থক্য তেমন নেই।"
              : "I measured it. On this one, the group is not really different from everyone else — which is itself worth knowing."}
          </div>
          <ol className="space-y-2.5">{askedFor.map((f, i) => factorRow(f, i, true))}</ol>
        </div>
      )}

      {/* A factor the user asked for that this dataset simply cannot measure. Named, with the reason
          — a silent omission would read as the request being ignored. */}
      {(reasoning.requestedUnavailable ?? []).length > 0 && (
        <div className="rounded-xl border border-[var(--oo-border)] bg-white p-4" style={{ boxShadow: "var(--oo-card-shadow)" }}>
          <div className="flex items-center gap-1.5 mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--oo-heading)]">
            <AlertTriangle size={12} className="text-[var(--oo-warning)]" />
            {bn ? "যেটি মাপা গেল না" : "What I could not measure"}
          </div>
          <ul className="space-y-2">
            {(reasoning.requestedUnavailable ?? []).map((u) => (
              <li key={u.id} className="text-[12.5px] text-[var(--oo-text)] leading-relaxed">
                <span className="font-semibold text-[var(--oo-heading)]">{u.plainLabel}</span> — {u.reason}.
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Ranked contributing factors — only for analytical questions, and only ones that passed
          the validity tests (not circular, not backwards, not trivial, materially different). */}
      {factors.length > 0 && (
        <div className="rounded-xl border border-[var(--oo-border)] bg-white p-4" style={{ boxShadow: "var(--oo-card-shadow)" }}>
          <div className="flex items-center gap-1.5 mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--oo-heading)]">
            <GitCompare size={12} className="text-[var(--oo-primary)]" />
            {bn ? "এই দলের মধ্যে যা মিল আছে" : "What this group has in common"}
          </div>
          <div className="text-[11px] text-[var(--oo-muted)] mb-3 leading-snug">
            {bn
              ? "এই বিষয়গুলো এখানে বেশি দেখা যায়। এগুলো সমস্যার সাথে যুক্ত, তবে কারণ প্রমাণিত নয়।"
              : "These things are more common here than in the rest of the programme. They go together with the problem — they do not prove what causes it."}
          </div>
          <ol className="space-y-2.5">{factors.map((f, i) => factorRow(f, i))}</ol>

          {protective && (
            <div className="mt-3.5 pt-3 border-t border-[var(--oo-border)]">
              <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--oo-info)] mb-2">
                {bn ? "যেটি এখানে সমস্যা নয়" : "One thing that is NOT a problem here"}
              </div>
              <ol className="space-y-2.5">{factorRow(protective, 0, true)}</ol>
            </div>
          )}
        </div>
      )}

      {/* Honest empty state — the list is never padded with invalid factors to look thorough. */}
      {noDriverNote && (
        <div className="flex items-start gap-2 text-[11.5px] text-[var(--oo-muted)] leading-relaxed">
          <AlertTriangle size={13} className="shrink-0 mt-0.5 text-[var(--oo-warning)]" />
          <span>{noDriverNote}</span>
        </div>
      )}

      {/* Plain-language interpretation — what the numbers mean together. */}
      {interpretation && (
        <div className="rounded-xl border border-[var(--oo-border)] bg-white p-4" style={{ boxShadow: "var(--oo-card-shadow)" }}>
          <div className="flex items-center gap-1.5 mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--oo-heading)]">
            <Compass size={12} className="text-[var(--oo-primary)]" />
            {bn ? (intent === "retrieval" ? "যা চোখে পড়ে" : "এর অর্থ কী") : intent === "retrieval" ? "What stands out" : "What this means"}
          </div>
          <p className="text-[13px] text-[var(--oo-text)] leading-relaxed m-0">{interpretation}</p>
        </div>
      )}

      {/* Confidence — qualifies, never terminates. */}
      <div className="flex items-start gap-2 text-[11.5px] text-[var(--oo-text)] leading-relaxed">
        <ShieldCheck size={13} className="shrink-0 mt-0.5" style={{ color: confColor }} />
        <span>
          <b className="font-semibold" style={{ color: confColor }}>
            {bn ? "নির্ভরযোগ্যতা" : "Confidence"}: {confLabel}.
          </b>{" "}
          <span className="text-[var(--oo-muted)]">{confidence.note}</span>
        </span>
      </div>

      {/* Action — only when the analysis earned one (never on a plain retrieval answer). */}
      {action && intent !== "retrieval" && (
        <div
          className="rounded-xl p-3.5 flex gap-2.5"
          style={{ background: "color-mix(in srgb, var(--oo-success) 8%, var(--oo-surface))", border: "1px solid color-mix(in srgb, var(--oo-success) 26%, transparent)" }}
        >
          <Compass size={14} className="shrink-0 mt-0.5 text-[var(--oo-success)]" />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--oo-success)] mb-1">
              {bn ? "প্রস্তাবিত পদক্ষেপ" : "Recommended action"}
            </div>
            <div className="text-[12.5px] text-[var(--oo-heading)] leading-relaxed">{action}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The single, full-screen dashboard for the current prompt — fills the height, does not page-scroll. */
function DashboardResult({ msg, index, question, lang, onAsk, onRegenerate }: {
  msg: ChatMsg; index: number; question: string; lang: Lang; onAsk: (q: string) => void; onRegenerate: (i: number) => void;
}) {
  const t = STR[lang];
  const lens = msg.lens ?? "context";

  // Refuse — a graceful centered card, not a broken dashboard.
  if (msg.refused) {
    return (
      <div className="flex flex-col items-center justify-center text-center gap-3 py-12">
        {question && <h2 className="font-head text-[17px] font-bold text-[var(--oo-heading)] leading-snug break-words max-w-md">{question}</h2>}
        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--oo-info) 12%, transparent)", color: "var(--oo-info)" }}>
          <Info size={22} />
        </div>
        <div className="max-w-md">
          {/* Show the actual message (rate-limit notice, or the specific reason the data can't
              answer) rather than a generic string. Falls back to the canned title if empty. */}
          <div className="text-[15px] font-bold text-[var(--oo-heading)] mb-1">{msg.text || t.refuseTitle}</div>
          {msg.followups && msg.followups.length > 0 && (
            <p className="text-[12.5px] text-[var(--oo-text)] leading-relaxed">{t.refuseBody}</p>
          )}
        </div>
        {msg.followups && msg.followups.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-center mt-1">
            {msg.followups.map((q) => (
              <button key={q} onClick={() => onAsk(q)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--oo-primary)] bg-[var(--oo-primary)]/8 border border-[var(--oo-primary)]/25 rounded-full px-3 py-1.5 hover:bg-[var(--oo-primary)]/14 transition-colors cursor-pointer">
                <ChevronRight size={12} />{q}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      {/* Header — the prompt as the dashboard title + trust signals + per-answer actions */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center flex-wrap gap-2 mb-1">
            <LensChip lens={lens} lang={lang} />
            {msg.grounded && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--oo-success)]"><Check size={11} />{t.grounded}</span>
            )}
            {msg.cached && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--oo-info)]"><Zap size={11} />{t.cached}</span>
            )}
          </div>
          <h2 className="font-head text-[19px] font-bold text-[var(--oo-heading)] leading-snug break-words">{question}</h2>
        </div>
        <div className="shrink-0">
          <MessageActions msg={msg} index={index} lang={lang} onRegenerate={onRegenerate} />
        </div>
      </div>

      {/* withheld notice */}
      {msg.withheld && (
        <div className="flex items-start gap-2 text-[11px] text-[#8a4a1d] bg-[var(--oo-warning)]/10 border border-[var(--oo-warning)]/25 rounded-md px-3 py-2 mb-3">
          <AlertTriangle size={11} className="shrink-0 mt-0.5 text-[var(--oo-warning)]" />
          <span>{t.withheld}</span>
        </div>
      )}

      {/* summary — a highlighted AI-insight panel (dashboard concept), not plain text */}
      <div
        className="rounded-xl p-4 mb-4 max-w-4xl"
        style={{ background: "linear-gradient(180deg, color-mix(in srgb, var(--oo-primary) 7%, var(--oo-surface)), var(--oo-surface))", border: "1px solid color-mix(in srgb, var(--oo-primary) 18%, transparent)" }}
      >
        <div className="flex items-center gap-1.5 mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--oo-primary)]">
          <Sparkles size={12} /> {msg.explained ? "Explanation" : msg.clarifying ? "One quick check" : msg.reasoning ? "Finding" : "Key insight"}
        </div>
        <Bullets text={msg.text} lang={lang} />
      </div>

      {/* "What does that mean?" — the terms THIS answer actually used, offered where the numbers are.
          A reader who does not know what a vulnerability score is should not have to know to ask. */}
      <ExplainChips text={msg.text} hidden={msg.explained || msg.clarifying} onAsk={onAsk} lang={lang} />

      {/* Layers 2-4: associated factors -> confidence -> action. Caveats are now a footnote below,
          never the conclusion — the answer ends on a specific next step. */}
      {msg.reasoning && <ReasoningPanel reasoning={msg.reasoning} lang={lang} />}

      {/* coverage / confidence caption — honesty about how complete the data behind this answer is */}
      {msg.coverage && (
        <div className="flex items-start gap-1.5 text-[11px] text-[var(--oo-muted)] -mt-2 mb-4 max-w-4xl">
          <ShieldCheck size={12} className="shrink-0 mt-0.5 text-[var(--oo-info)]" />
          <span>{msg.coverage}</span>
        </div>
      )}

      {/* widgets — a real (scrollable) dashboard grid with full-height charts */}
      <MessageWidgets widgets={msg.response?.widgets} />

      {/* follow-ups — drill-down suggestions */}
      {msg.followups && msg.followups.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4">
          {msg.followups.map((q) => (
            <button key={q} onClick={() => onAsk(q)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--oo-primary)] bg-[var(--oo-primary)]/8 border border-[var(--oo-primary)]/25 rounded-full px-3 py-1.5 hover:bg-[var(--oo-primary)]/14 transition-colors cursor-pointer whitespace-nowrap">
              <ChevronRight size={12} />{q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Offers a plain-language definition for each scored term the answer just used.
 *
 * The reader who most needs "what does vulnerability score mean?" is exactly the reader who does not
 * know the phrase is askable. So the offer is attached to the answer, next to the number, rather
 * than left to be discovered. Suppressed on an explanation itself, which would otherwise loop.
 */
function ExplainChips({ text, hidden, onAsk, lang }: { text: string; hidden?: boolean; onAsk: (q: string) => void; lang: Lang }) {
  if (hidden) return null;
  const terms = findTerms(text).slice(0, 3);
  if (!terms.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 -mt-2 mb-4 max-w-4xl">
      <span className="text-[11px] text-[var(--oo-muted)]">
        {lang === "bn" ? "মানে কী?" : "What does this mean?"}
      </span>
      {terms.map((term) => (
        <button
          key={term.id}
          onClick={() => onAsk(`What does ${term.term.toLowerCase()} mean?`)}
          title={term.short}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--oo-muted)] bg-[var(--oo-canvas)] border border-[var(--oo-input-border)] rounded-full px-2.5 py-1 hover:text-[var(--oo-primary)] hover:border-[var(--oo-primary)]/40 transition-colors cursor-pointer whitespace-nowrap"
        >
          <HelpCircle size={11} />
          {term.term}
        </button>
      ))}
    </div>
  );
}

/** Inline "generating…" card for the pending turn — sits in the thread, doesn't take over the screen. */
function GeneratingCard({ question, lang }: { question: string; lang: Lang }) {
  const t = STR[lang];
  return (
    <div className="max-w-5xl mx-auto w-full flex flex-col items-center justify-center text-center gap-4 py-16">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white" style={{ background: "linear-gradient(140deg, var(--oo-primary), #8f78f0)" }}>
        <Bot size={30} />
      </div>
      <div>
        <div className="flex items-center justify-center gap-1.5 mb-2.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="w-2 h-2 rounded-full bg-[var(--oo-primary)] animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
        <div className="text-[15px] font-bold text-[var(--oo-heading)]">{t.generating}</div>
        {question && <div className="text-[12.5px] text-[var(--oo-muted)] mt-1.5 max-w-md mx-auto">“{question}”</div>}
      </div>
    </div>
  );
}

export function ChatView({
  messages,
  onAsk,
  lang = "en",
  isThinking = false,
  onRegenerate = () => {},
}: {
  messages: ChatMsg[];
  onAsk: (q: string) => void;
  lang?: Lang;
  isThinking?: boolean;
  onRegenerate?: (index: number) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const started = messages.some((m) => m.role === "user");

  // Keep the newest turn in view as answers stream in and follow-ups stack below.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, isThinking]);

  if (!started) return <EmptyState lang={lang} onAsk={onAsk} />;

  // Full conversation thread: pair every question with the AI answer that follows it, then render
  // each turn stacked so follow-ups accumulate (earlier prompts stay visible, not replaced).
  const turns: { question: string; answer?: ChatMsg; answerIdx: number }[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== "user") continue;
    let answer: ChatMsg | undefined;
    let answerIdx = -1;
    for (let j = i + 1; j < messages.length && messages[j].role !== "user"; j++) {
      if (messages[j].role === "ai" && (messages[j].response !== undefined || messages[j].refused)) {
        answer = messages[j];
        answerIdx = j;
        break;
      }
    }
    turns.push({ question: messages[i].text, answer, answerIdx });
  }

  return (
    <div className="space-y-10">
      {turns.map((turn, ti) => (
        <div key={ti} className={ti > 0 ? "pt-10 border-t border-[var(--oo-border)]" : ""}>
          {turn.answer ? (
            <DashboardResult
              msg={turn.answer}
              index={turn.answerIdx}
              question={turn.question}
              lang={lang}
              onAsk={onAsk}
              onRegenerate={onRegenerate}
            />
          ) : (
            <GeneratingCard question={turn.question} lang={lang} />
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

export default ChatView;
