import { useState, useRef, useEffect } from "react";
import {
  Search, Sparkles, Users, GitCompare,
  BarChart2,
  MapPin, Layers, FileText, ChevronLeft, ChevronRight,
} from "lucide-react";
import { askViaPipeline, type AskResult, type HistoryTurn } from "./lib/ai/ask-browser";
import { getDataMode, setDataSourceMode, type DataMode } from "./lib/db";
import type { DynamicDashboardResponse } from "./utils/openAIHelper";
import type { ChatMsg, Conversation } from "./lib/types";
import { totals } from "./lib/aggregates";
import { fmtInt, type Lang } from "./lib/fmt";
import { inferLens, inferSeverity, deriveFollowups, genericRecommendation } from "./utils/chatMeta";
import { matchPlaybook, playbookCoverage } from "./lib/ai/playbooks";
import { DashboardView } from "./views/DashboardView";
import { CopilotPanel } from "./components/copilot/CopilotPanel";

// Sidebar mirrors the live EMDC menu. `dashboard` items drive the main canvas; the rest are
// live-system sections shown as placeholders so the menu matches without dead buttons.
type NavItem = { label: string; icon: typeof BarChart2; dashboard?: boolean; copilot?: boolean; badge?: string };
const NAV_GROUPS: { group: string; items: NavItem[] }[] = [
  {
    group: "Intelligence",
    items: [
      { label: "AI Copilot", icon: Sparkles, copilot: true, badge: "NEW" },
      { label: "Dashboard", icon: BarChart2, dashboard: true },
    ],
  },
  {
    group: "Programme",
    items: [
      { label: "Centres on Map", icon: MapPin },
      { label: "Result Comparison", icon: GitCompare },
      { label: "Master Setup", icon: Layers },
      { label: "Staff & Teachers", icon: Users },
      { label: "Export Data", icon: FileText },
    ],
  },
];

export default function App() {
  const [prompt, setPrompt] = useState("");
  // AI keys + provider failover (Gemini → OpenAI on rate-limit) are handled inside askViaPipeline,
  // driven by .env (VITE_GEMINI_API_KEY / VITE_OPENAI_API_KEY). No key plumbing needed here.

  const [isThinking, setIsThinking] = useState(false);

  // Data mode: switch the whole app (dashboards + chat) between REAL and gap-filled PREVIEW data.
  const [dataMode, setDataMode] = useState<DataMode>(() => getDataMode());
  const [switchingMode, setSwitchingMode] = useState(false);
  const switchDataMode = async (m: DataMode) => {
    if (m === dataMode || switchingMode) return;
    setSwitchingMode(true);
    try { await setDataSourceMode(m); setDataMode(m); }
    catch (e) { console.error("data mode switch failed", e); }
    finally { setSwitchingMode(false); }
  };
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("lang") as Lang) || "en");
  const [collapsed, setCollapsed] = useState(false);
  const [placeholder, setPlaceholder] = useState<string | null>(null);
  // Restored on reload so refreshing the Copilot keeps you on the Copilot (not the dashboard).
  const [copilotOpen, setCopilotOpen] = useState<boolean>(() => localStorage.getItem("copilot_open") === "1");

  // ── Chat history: many conversations, one active (Claude-style) ──────────────
  function makeConversation(): Conversation {
    return {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `c_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      title: "New chat",
      messages: [
        {
          role: "ai",
          text:
            `Hello! I'm your NFPE intelligence assistant. I have database access to 3 accelerated ` +
            `learning programs (ABAL, Catchup, Innovation) covering ${fmtInt(totals.students)} students and ` +
            `${fmtInt(totals.teachers)} teachers. Ask me about enrollment, teacher qualifications, dropouts, ` +
            `divisions, or student nutrition — every answer is computed from the dataset.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ],
    };
  }
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const raw = localStorage.getItem("eduintel_chats");
      if (raw) {
        const parsed = JSON.parse(raw) as Conversation[];
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch {
      /* corrupt/unavailable — start fresh */
    }
    return [makeConversation()];
  });
  const [activeId, setActiveId] = useState<string>(() => {
    const saved = localStorage.getItem("eduintel_active_chat");
    if (saved && conversations.some((c) => c.id === saved)) return saved;
    return conversations[0].id;
  });

  const activeConvo = conversations.find((c) => c.id === activeId) ?? conversations[0];
  const messages = activeConvo.messages;

  const inputRef = useRef<HTMLInputElement>(null);

  // Persist chat history (best-effort; large widget payloads may hit quota — degrade silently).
  useEffect(() => {
    try {
      localStorage.setItem("eduintel_chats", JSON.stringify(conversations.slice(0, 30)));
    } catch {
      /* quota / disabled */
    }
  }, [conversations]);

  // Persist the current view + active conversation so a reload lands you back where you were.
  useEffect(() => {
    try {
      localStorage.setItem("copilot_open", copilotOpen ? "1" : "0");
      localStorage.setItem("eduintel_active_chat", activeId);
    } catch {
      /* quota / disabled */
    }
  }, [copilotOpen, activeId]);

  const handleNav = (item: NavItem) => {
    if (item.copilot) {
      setCopilotOpen(true);
      return;
    }
    if (item.dashboard) setPlaceholder(null);
    else setPlaceholder(item.label);
  };

  // ── Chat management ──────────────────────────────────────────────────────────
  const newChat = () => {
    const c = makeConversation();
    setConversations((prev) => [c, ...prev].slice(0, 30));
    setActiveId(c.id);
    setCopilotOpen(true);
  };
  const switchChat = (id: string) => setActiveId(id);
  const renameChat = (id: string, title: string) => {
    const t = title.trim();
    if (!t) return;
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: t, renamed: true } : c)));
  };
  const pinChat = (id: string) => setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)));
  const archiveChat = (id: string) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, archived: true } : c)));
    if (id === activeId) {
      const other = conversations.find((c) => c.id !== id && !c.archived);
      if (other) setActiveId(other.id);
      else newChat();
    }
  };
  const deleteChat = (id: string) => {
    // Compute from the current render's state and call setters at the top level — never call a
    // setter inside another setter's updater (impure; StrictMode double-invokes updaters).
    const remaining = conversations.filter((c) => c.id !== id);
    if (remaining.length === 0) {
      const fresh = makeConversation();
      setConversations([fresh]);
      setActiveId(fresh.id);
      return;
    }
    setConversations(remaining);
    if (id === activeId) setActiveId(remaining[0].id);
  };

  // ── Query → grounded message ─────────────────────────────────────────────────
  const stamp = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // Map a pipeline result → chat message. The pipeline is grounded by construction (every number
  // comes straight from the SQL result over the semantic views), so there is no narrative guardrail
  // to run here; a refusal simply carries no widgets. The executed SQL is attached as the source.
  const buildPipelineMessage = (text: string, res: AskResult): ChatMsg => {
    const response = res.response as DynamicDashboardResponse;
    const widgets = response.widgets ?? [];
    const summary = response.summary;
    const lens = res.refused ? "context" : inferLens(summary, widgets);
    const severity = res.rateLimited ? "warn" : res.refused ? "info" : inferSeverity(summary, lens);
    // Predictive analyses add a specific advisory recommendation + an honest coverage note. Any other
    // (non-refused) analysis gets a generic, severity-aware recommendation so every answer is actionable.
    const pb = res.refused ? undefined : matchPlaybook(text);
    const reco = pb ? pb.recommendation : (!res.refused && widgets.length > 0 ? genericRecommendation(lens) : undefined);
    const summaryText = reco ? `${summary}\n* **Recommended:** ${reco}` : summary;
    return {
      role: "ai",
      text: summaryText,
      timestamp: stamp(),
      response: res.refused ? null : response,
      lens,
      severity,
      grounded: !res.refused,
      refused: res.refused,
      followups: deriveFollowups(text, widgets),
      coverage: res.refused ? undefined : playbookCoverage(text, dataMode),
      engine: res.provider === "openai" ? "openai" : "gemini",
      sources: res.sql ? [res.sql] : undefined,
    };
  };

  const handleSubmit = async (text: string) => {
    if (!text.trim()) return;
    setCopilotOpen(true);
    const targetId = activeConvo.id;
    const appendAi = (m: ChatMsg) =>
      setConversations((prev) => prev.map((c) => (c.id === targetId ? { ...c, messages: [...c.messages, m] } : c)));

    setConversations((prev) =>
      prev.map((c) =>
        c.id === targetId
          ? {
              ...c,
              title: c.renamed || c.messages.some((m) => m.role === "user") ? c.title : text.length > 40 ? `${text.slice(0, 40)}…` : text,
              messages: [...c.messages, { role: "user", text, timestamp: stamp() }],
            }
          : c
      )
    );
    setIsThinking(true);
    setPrompt("");

    try {
      // Recent turns (with the SQL each ran) so follow-ups like "this student", "and for girls?" resolve.
      const history: HistoryTurn[] = messages
        .filter((m) => m.role === "user" || m.response !== undefined || m.refused)
        .slice(-6)
        .map((m) => ({ role: m.role, text: m.text, sql: m.sources?.[0] ?? null }));
      const res = await askViaPipeline(text, history);
      appendAi(buildPipelineMessage(text, res));
    } catch (e) {
      console.error("AI query error:", e);
      appendAi({
        role: "ai",
        text: "I couldn't complete that analysis. Please try rephrasing your question.",
        timestamp: stamp(),
        refused: true,
        followups: deriveFollowups(text, []),
      });
    } finally {
      setIsThinking(false);
    }
  };

  const regenerate = async (index: number) => {
    const targetId = activeConvo.id;
    const msgs = activeConvo.messages;
    let userText = "";
    for (let i = index - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        userText = msgs[i].text;
        break;
      }
    }
    if (!userText) return;
    setIsThinking(true);
    try {
      const history: HistoryTurn[] = msgs.slice(0, index)
        .filter((m) => m.role === "user" || m.response !== undefined || m.refused)
        .slice(-6)
        .map((m) => ({ role: m.role, text: m.text, sql: m.sources?.[0] ?? null }));
      const res = await askViaPipeline(userText, history);
      const ai = buildPipelineMessage(userText, res);
      setConversations((prev) => prev.map((c) => (c.id === targetId ? { ...c, messages: c.messages.map((m, i) => (i === index ? ai : m)) } : c)));
    } catch (e) {
      console.error("Regenerate error:", e);
    } finally {
      setIsThinking(false);
    }
  };

  // The composer, rendered inside the dock (centered when empty, bottom bar once chatting).
  // The prompt bar (bottom, Claude-style). Starter suggestions live in the empty-state Quick prompts
  // section, so the composer itself is just the input + Ask button.
  const composerInner = (
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2.5 bg-[var(--oo-canvas)] border border-[var(--oo-input-border)] rounded-md px-3 py-2.5">
          <Search size={15} className="text-[var(--oo-muted)] shrink-0" />
          <input
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit(prompt)}
            placeholder="Describe a dashboard to generate — e.g. “dropout drivers by programme”…"
            className="flex-1 bg-transparent text-[13.5px] text-[var(--oo-heading)] placeholder:text-[var(--oo-muted)] outline-none min-w-0"
          />
        </div>
        <button
          onClick={() => handleSubmit(prompt)}
          disabled={isThinking || !prompt.trim()}
          className="flex items-center gap-2 bg-[var(--oo-primary)] hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-[13.5px] px-5 py-2.5 rounded-md transition-all cursor-pointer shrink-0"
        >
          <Sparkles size={14} />
          Ask
        </button>
      </div>
  );

  return (
    <div className="h-screen w-screen bg-[var(--oo-canvas)] flex overflow-hidden">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside
        className={`${collapsed ? "w-[64px]" : "w-60"} shrink-0 flex flex-col overflow-hidden transition-[width] duration-200 ease-out`}
        style={{ background: "var(--oo-sidebar)" }}
      >
        <div className={`h-[57px] shrink-0 flex items-center gap-2.5 border-b border-white/10 ${collapsed ? "justify-center px-0" : "px-4"}`}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "linear-gradient(140deg, var(--oo-primary), #8f78f0)" }}>
            <BarChart2 size={16} className="text-white" />
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0">
                <div className="font-head text-[13.5px] font-bold text-white leading-tight truncate">Let us learn</div>
                <div className="text-[9px] text-white/45">AI assistant · NFPE Bangladesh</div>
              </div>
              <button onClick={() => setCollapsed(true)} className="ml-auto text-white/40 hover:text-white transition-colors cursor-pointer" aria-label="Collapse sidebar">
                <ChevronLeft size={16} />
              </button>
            </>
          )}
        </div>

        {collapsed && (
          <button onClick={() => setCollapsed(false)} className="mx-auto mt-2 mb-1 w-8 h-8 rounded-md flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer" aria-label="Expand sidebar">
            <ChevronRight size={16} />
          </button>
        )}

        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_GROUPS.map((g) => (
            <div key={g.group} className="px-2 mb-1.5">
              {!collapsed && <div className="text-[9px] font-bold text-white/35 uppercase tracking-widest px-2.5 pt-2 pb-1.5">{g.group}</div>}
              {g.items.map((item) => {
                const active = item.copilot
                  ? copilotOpen
                  : item.dashboard
                    ? !placeholder && !copilotOpen
                    : placeholder === item.label && !copilotOpen;
                return (
                  <button
                    key={item.label}
                    onClick={() => handleNav(item)}
                    title={collapsed ? item.label : undefined}
                    className={`w-full flex items-center gap-3 rounded-md px-2.5 py-2 mb-0.5 transition-colors cursor-pointer ${collapsed ? "justify-center" : ""} ${
                      active ? "text-white font-semibold" : "text-white/65 hover:text-white hover:bg-white/[0.08]"
                    }`}
                    style={active ? { background: "var(--oo-primary)" } : undefined}
                  >
                    <item.icon size={16} className="shrink-0" />
                    {!collapsed && <span className="text-[12px] leading-tight truncate">{item.label}</span>}
                    {!collapsed && item.badge && (
                      <span className="ml-auto text-[8px] font-bold bg-white/20 text-white rounded px-1.5 py-0.5 tracking-wide">{item.badge}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={`shrink-0 border-t border-white/10 flex items-center gap-2.5 p-3 ${collapsed ? "justify-center" : ""}`}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12px] font-bold shrink-0" style={{ background: "linear-gradient(135deg, #f0a, #6b62e6)" }}>
            A
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-white truncate">Admin</div>
              <div className="text-[10px] text-white/45">Program Manager</div>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="shrink-0 border-b border-[var(--oo-border)] bg-white px-6 py-3 flex items-center gap-3">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="shrink-0 w-8 h-8 -ml-2 rounded-md flex items-center justify-center text-[var(--oo-muted)] hover:text-[var(--oo-heading)] hover:bg-[var(--oo-canvas)] transition-colors cursor-pointer"
            aria-label="Toggle sidebar"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--oo-success)]" />
              <span className="text-[10px] font-bold text-[var(--oo-muted)] uppercase tracking-widest">Intelligence</span>
            </div>
            <div className="font-head text-[15px] font-semibold text-[var(--oo-heading)] mt-0.5 truncate">
              {placeholder ?? "NFPE Programme Overview"}
            </div>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            {/* Data-source switch: flips the WHOLE app between real data and the gap-filled preview. */}
            {switchingMode && <span className="text-[11px] text-[var(--oo-muted)]">loading…</span>}
            <div className="flex items-center border border-[var(--oo-border)] rounded-md overflow-hidden" role="group" aria-label="Data source">
              {(["real", "tuned"] as DataMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => switchDataMode(m)}
                  disabled={switchingMode}
                  title={m === "real" ? "Real programme data (honest, with gaps)" : "Preview — gaps filled with estimated values"}
                  className={`text-[11px] font-bold px-2.5 py-1.5 transition-colors cursor-pointer disabled:opacity-60 ${
                    dataMode === m
                      ? m === "tuned" ? "bg-[var(--oo-warning)] text-white" : "bg-[var(--oo-primary)] text-white"
                      : "bg-white text-[var(--oo-muted)] hover:text-[var(--oo-heading)]"
                  }`}
                >
                  {m === "real" ? "Real" : "Preview"}
                </button>
              ))}
            </div>

            <div className="flex items-center border border-[var(--oo-border)] rounded-md overflow-hidden">
              {(["en", "bn"] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => {
                    setLang(l);
                    localStorage.setItem("lang", l);
                  }}
                  className={`text-[11px] font-bold px-2.5 py-1.5 transition-colors cursor-pointer ${
                    lang === l ? "bg-[var(--oo-primary)] text-white" : "bg-white text-[var(--oo-muted)] hover:text-[var(--oo-heading)]"
                  }`}
                  aria-label={l === "en" ? "English" : "Bengali"}
                >
                  {l === "en" ? "EN" : "বাং"}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* Preview-mode ribbon — impossible to miss; the values are estimated, not measured. */}
        {dataMode === "tuned" && (
          <div className="shrink-0 px-6 py-2 text-[12px] flex items-center gap-2 border-b" style={{ background: "color-mix(in srgb, var(--oo-warning) 14%, white)", borderColor: "color-mix(in srgb, var(--oo-warning) 40%, transparent)", color: "var(--oo-heading)" }}>
            <span>⚠️</span>
            <span><b>Preview mode</b> — attendance, marks and status are <b>estimated</b> where the real data was blank. For demonstration only, not for decisions.</span>
          </div>
        )}

        {/* Dashboard canvas (Copilot is a full-screen overlay, not a dock).
            Keyed by dataMode so switching real ⇄ preview remounts the views → they re-fetch. */}
        <main key={dataMode} className="flex-1 overflow-y-auto px-6 pt-6 min-w-0">
          {placeholder ? (
            <div className="max-w-lg mx-auto mt-[12vh] text-center">
              <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-[var(--oo-primary)]/10 text-[var(--oo-primary)]">
                <Layers size={24} />
              </div>
              <h2 className="font-head text-[20px] font-bold text-[var(--oo-heading)] mb-2">{placeholder}</h2>
              <p className="text-[13px] text-[var(--oo-text)] leading-relaxed mb-5">
                This section mirrors the live EMDC management system and isn't part of the AI prototype. The
                prototype focuses on the <strong>Dashboard</strong> and the <strong>AI Copilot</strong> — ask a
                question of the data to get grounded answers, charts and reports.
              </p>
              <button
                onClick={() => {
                  setPlaceholder(null);
                  setCopilotOpen(true);
                }}
                className="inline-flex items-center gap-2 bg-[var(--oo-primary)] text-white text-[13px] font-semibold px-5 py-2.5 rounded-md hover:brightness-95 transition-all cursor-pointer"
              >
                <Sparkles size={14} />
                Ask the Copilot
              </button>
            </div>
          ) : (
            <DashboardView onAsk={handleSubmit} />
          )}
        </main>
      </div>

      {/* Full-screen Copilot (Claude-style chat) */}
      {copilotOpen && (
        <CopilotPanel
          conversations={conversations}
          activeConvo={activeConvo}
          messages={messages}
          lang={lang}
          isThinking={isThinking}
          composer={composerInner}
          onAsk={handleSubmit}
          onRegenerate={regenerate}
          onNewChat={newChat}
          onSwitch={switchChat}
          onRename={renameChat}
          onPin={pinChat}
          onArchive={archiveChat}
          onDelete={deleteChat}
          onClose={() => setCopilotOpen(false)}
          dataMode={dataMode}
          switchingMode={switchingMode}
          onSwitchMode={switchDataMode}
        />
      )}

      {/* Floating button to open the Copilot */}
      {!copilotOpen && (
        <button
          onClick={() => setCopilotOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-[var(--oo-primary)] text-white font-semibold text-[13px] px-5 py-3 rounded-full shadow-lg hover:brightness-95 transition-all cursor-pointer"
          style={{ boxShadow: "0 10px 30px -8px color-mix(in srgb, var(--oo-primary) 55%, transparent)" }}
        >
          <Sparkles size={15} />
          Ask Copilot
        </button>
      )}

    </div>
  );
}
