import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  Bot, Sparkles, Target, Award, AlertTriangle, Compass, ShieldCheck, Info,
  Check, Copy, ChevronRight, Zap,
  Share2, RotateCcw, MoreHorizontal, Printer, Table2, Volume2, X, Database, FileText,
  GraduationCap, Users, Coffee, Activity, GitCompare, ShieldAlert,
} from "lucide-react";

/** Quick prompts shown on the empty "What dashboard can I generate?" screen — click to generate. */
const QUICK_PROMPTS = [
  { icon: ShieldAlert, color: "var(--oo-danger)", q: "Show dropout reasons for ABAL program" },
  { icon: Award, color: "var(--oo-warning)", q: "Show average marks by subject in Catchup" },
  { icon: GraduationCap, color: "var(--oo-info)", q: "Analyze teacher education levels" },
  { icon: Users, color: "var(--oo-primary)", q: "Compare student enrollment by grade" },
  { icon: AlertTriangle, color: "var(--oo-danger)", q: "Which centers have the lowest score?" },
  { icon: Coffee, color: "var(--band-green)", q: "Check student nutrition evaluation" },
  { icon: Activity, color: "var(--oo-warning)", q: "Teacher experience distribution" },
  { icon: GitCompare, color: "var(--oo-primary)", q: "Compare program enrollment & mainstreaming" },
] as const;
import type { ChatMsg, Lens } from "../lib/types";
import { LENS_STYLE } from "../utils/chatMeta";
import { MessageWidgets } from "../components/dash/MessageWidgets";
import { toBnNumerals, type Lang } from "../lib/fmt";
import { messageToMarkdown, messageToCsv, messageToHtml, download, printHtml, speak, stripMd } from "../utils/chatExport";
import { SharePopup } from "../components/copilot/SharePopup";

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

function EmptyState({ lang, onAsk }: { lang: Lang; onAsk: (q: string) => void }) {
  const t = STR[lang];
  return (
    <div className="min-h-full flex flex-col items-center justify-center py-10">
      <div
        className="w-16 h-16 rounded-2xl mb-5 flex items-center justify-center text-white"
        style={{ background: "linear-gradient(140deg, var(--oo-primary), #8f78f0)", boxShadow: "0 12px 30px -8px color-mix(in srgb, var(--oo-primary) 55%, transparent)" }}
      >
        <Bot size={30} />
      </div>
      <h1 className="font-head text-[24px] font-bold text-[var(--oo-heading)] tracking-tight mb-2.5 max-w-xl text-center">{t.greet}</h1>
      <p className="text-[13.5px] text-[var(--oo-muted)] max-w-md leading-relaxed text-center">{t.genSub}</p>

      {/* Quick prompts — click to generate a dashboard */}
      <div className="mt-9 w-full max-w-2xl">
        <div className="text-[10px] font-bold text-[var(--oo-muted)] uppercase tracking-widest mb-3">
          {lang === "bn" ? "দ্রুত প্রম্পট" : "Quick prompts"}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {QUICK_PROMPTS.map(({ icon: Icon, color, q }) => (
            <button
              key={q}
              onClick={() => onAsk(q)}
              className="flex items-center gap-3 text-left bg-white border border-[var(--oo-border)] rounded-xl px-3.5 py-3 hover:border-[var(--oo-primary)] hover:shadow-sm transition-all cursor-pointer group"
            >
              <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
                <Icon size={15} />
              </span>
              <span className="text-[12.5px] font-semibold text-[var(--oo-heading)] leading-snug">{q}</span>
              <ChevronRight size={14} className="ml-auto text-[#c6cbe8] group-hover:text-[var(--oo-primary)] shrink-0" />
            </button>
          ))}
        </div>
      </div>
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
          <div className="text-[15px] font-bold text-[var(--oo-heading)] mb-1">{t.refuseTitle}</div>
          <p className="text-[12.5px] text-[var(--oo-text)] leading-relaxed">{t.refuseBody}</p>
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
          <Sparkles size={12} /> Key insight
        </div>
        <Bullets text={msg.text} lang={lang} />
      </div>

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
