import { useState, type ReactNode } from "react";
import {
  Bot, MessageSquare, ArrowLeft, Share2, MoreHorizontal, X, Plus, Search,
  Pin, PinOff, Archive, Trash2, Printer, Table2, FileText, ScrollText, Pencil, Check,
} from "lucide-react";
import type { ChatMsg, Conversation } from "../../lib/types";
import type { Lang } from "../../lib/fmt";
import { ChatView } from "../../views/ChatView";
import { SharePopup } from "./SharePopup";
import {
  conversationToMarkdown, conversationToCsv, conversationToHtml, conversationSummary, download, printHtml,
} from "../../utils/chatExport";

/**
 * AI Copilot — full-screen "Let us learn — AI assistant" chat: a soft indigo canvas, a
 * white top bar, a left assistant rail (robot greeting · recent chats) and the chat card
 * ("AI Chat · AI assistant is online" + New Chat). The composer sits at the TOP of the chat; answers
 * appear below it and history stacks underneath (handled by ChatView).
 */

export function CopilotPanel({
  conversations,
  activeConvo,
  messages,
  lang,
  isThinking,
  composer,
  onAsk,
  onRegenerate,
  onNewChat,
  onSwitch,
  onRename,
  onPin,
  onArchive,
  onDelete,
  onClose,
}: {
  conversations: Conversation[];
  activeConvo: Conversation;
  messages: ChatMsg[];
  lang: Lang;
  isThinking: boolean;
  composer: ReactNode;
  onAsk: (q: string) => void;
  onRegenerate: (index: number) => void;
  onNewChat: () => void;
  onSwitch: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [share, setShare] = useState(false);
  const [summary, setSummary] = useState<{ md: string; html: string } | null>(null);
  const [q, setQ] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startRename = (c: Conversation) => { setEditingId(c.id); setEditValue(c.title); };
  const commitRename = () => {
    if (editingId) onRename(editingId, editValue);
    setEditingId(null);
  };

  const firstQuestion = activeConvo.messages.find((m) => m.role === "user")?.text;
  const visible = conversations
    .filter((c) => !c.archived)
    .filter((c) => c.title.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));

  return (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: "#e9ebfb" }}>
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="h-[56px] shrink-0 bg-white/90 backdrop-blur border-b border-[#e3e6f8] flex items-center gap-3 px-4">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--oo-text)] hover:text-[var(--oo-primary)] transition-colors cursor-pointer"
          title="Back to dashboard"
        >
          <ArrowLeft size={17} />
          <span className="hidden sm:inline">Dashboard</span>
        </button>
        <div className="w-px h-5 bg-[#e3e6f8]" />
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: "linear-gradient(140deg, var(--oo-primary), #8f78f0)" }}>
            <Bot size={16} />
          </div>
          <span className="font-head text-[15px] font-bold text-[var(--oo-heading)]">
            Let us learn <span className="text-[var(--oo-primary)]">AI assistant</span>
          </span>
        </div>
        <div className="flex-1" />
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12px] font-bold" style={{ background: "linear-gradient(135deg, #f0a, #6b62e6)" }}>
          A
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 w-full max-w-[1800px] mx-auto px-4 py-4 flex gap-4">
        {/* Left assistant rail */}
        <aside className="w-[270px] shrink-0 hidden lg:flex flex-col gap-4 overflow-hidden pb-2">
          <div className="bg-white border border-[#e3e6f8] rounded-2xl p-5 text-center" style={{ boxShadow: "0 2px 14px rgba(93,98,224,.06)" }}>
            <div className="w-16 h-16 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: "#eef0fe" }}>
              <Bot size={30} className="text-[var(--oo-primary)]" />
            </div>
            <div className="font-head text-[16px] font-bold text-[var(--oo-heading)]">Hi Admin! 👋</div>
            <div className="inline-flex items-center gap-1.5 mt-2 text-[10px] font-bold text-[#0d8a5f] bg-[#e7faf3] border border-[#bfeedd] rounded-full px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#14ba7f]" />
              AI is ready to assist
            </div>
          </div>

          {/* Recent chats (replaces the quick-actions list) */}
          <div className="bg-white border border-[#e3e6f8] rounded-2xl p-3 flex-1 min-h-0 flex flex-col" style={{ boxShadow: "0 2px 14px rgba(93,98,224,.06)" }}>
            <div className="flex items-center justify-between px-2 pt-1 pb-2">
              <span className="text-[10px] font-bold text-[var(--oo-muted)] uppercase tracking-widest">Recent chats</span>
              <button onClick={onNewChat} title="New chat" className="w-6 h-6 rounded-lg flex items-center justify-center text-[var(--oo-primary)] bg-[#eef0fe] hover:brightness-95 transition cursor-pointer">
                <Plus size={13} />
              </button>
            </div>
            <div className="px-1 pb-2">
              <div className="flex items-center gap-2 bg-[#f4f5fd] border border-[#e3e6f8] rounded-lg px-2 py-1.5">
                <Search size={12} className="text-[var(--oo-muted)]" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search chats…"
                  className="flex-1 bg-transparent text-[12px] outline-none text-[var(--oo-heading)] placeholder:text-[var(--oo-muted)] min-w-0"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar space-y-0.5">
              {visible.length === 0 && <div className="px-2 py-4 text-[11px] text-[var(--oo-muted)] text-center">No conversations yet</div>}
              {visible.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors ${
                    c.id === activeConvo.id ? "bg-[var(--oo-primary)]/10 text-[var(--oo-primary)]" : "hover:bg-[#f4f5fd] text-[var(--oo-text)]"
                  }`}
                >
                  {editingId === c.id ? (
                    <>
                      <MessageSquare size={12} className="shrink-0 text-[var(--oo-primary)]" />
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingId(null); }}
                        onBlur={commitRename}
                        className="flex-1 min-w-0 bg-white border border-[var(--oo-primary)]/40 rounded-md px-1.5 py-0.5 text-[12.5px] outline-none text-[var(--oo-heading)]"
                      />
                      <button onMouseDown={(e) => e.preventDefault()} onClick={commitRename} title="Save name" className="text-[var(--oo-primary)] shrink-0 cursor-pointer">
                        <Check size={13} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => onSwitch(c.id)} onDoubleClick={() => startRename(c)} className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer">
                        {c.pinned ? <Pin size={12} className="shrink-0" /> : <MessageSquare size={12} className="shrink-0" />}
                        <span className="text-[12.5px] truncate">{c.title}</span>
                      </button>
                      <button
                        onClick={() => startRename(c)}
                        title="Rename conversation"
                        className="opacity-0 group-hover:opacity-100 text-[var(--oo-muted)] hover:text-[var(--oo-primary)] transition-all shrink-0 cursor-pointer"
                      >
                        <Pencil size={12} />
                      </button>
                      {visible.length > 1 && (
                        <button
                          onClick={() => onDelete(c.id)}
                          title="Delete conversation"
                          className="opacity-0 group-hover:opacity-100 text-[var(--oo-muted)] hover:text-[var(--oo-danger)] transition-all shrink-0 cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Chat card */}
        <section className="flex-1 min-w-0 bg-white border border-[#e3e6f8] rounded-2xl flex flex-col overflow-hidden" style={{ boxShadow: "0 2px 14px rgba(93,98,224,.06)" }}>
          {/* Chat header */}
          <div className="h-[54px] shrink-0 border-b border-[#eceef9] flex items-center gap-2.5 px-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: "linear-gradient(140deg, var(--oo-primary), #8f78f0)" }}>
              <Bot size={15} />
            </div>
            <div className="min-w-0">
              <div className="text-[13.5px] font-bold text-[var(--oo-heading)] leading-none">AI Chat</div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#14ba7f]" />
                <span className="text-[9.5px] font-semibold text-[#0d8a5f]">AI assistant is online</span>
              </div>
            </div>

            <div className="flex-1" />

            <IconBtn title="Share" onClick={() => setShare(true)}>
              <Share2 size={15} />
            </IconBtn>

            {/* ⋯ conversation menu */}
            <div className="relative">
              <IconBtn title="More" onClick={() => setMenu((o) => !o)}>
                <MoreHorizontal size={16} />
              </IconBtn>
              {menu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
                  <div className="absolute right-0 top-9 z-50 w-56 bg-white border border-[#e3e6f8] rounded-xl shadow-lg py-1">
                    <Row icon={activeConvo.pinned ? PinOff : Pin} label={activeConvo.pinned ? "Unpin chat" : "Pin chat"} onClick={() => { onPin(activeConvo.id); setMenu(false); }} />
                    <Row icon={Archive} label="Archive" onClick={() => { onArchive(activeConvo.id); setMenu(false); }} />
                    <Row icon={ScrollText} label="Generate summary" onClick={() => { setSummary(conversationSummary(activeConvo)); setMenu(false); }} />
                    <div className="my-1 border-t border-[#eceef9]" />
                    <div className="px-3 py-1 text-[10px] font-bold text-[var(--oo-muted)] uppercase tracking-wider">Export conversation</div>
                    <Row icon={Printer} label="As PDF (full chat)" onClick={() => { printHtml(conversationToHtml(activeConvo), activeConvo.title); setMenu(false); }} />
                    <Row icon={Table2} label="As Excel (CSV)" onClick={() => { download("conversation.csv", conversationToCsv(activeConvo), "text/csv"); setMenu(false); }} />
                    <Row icon={FileText} label="As Markdown" onClick={() => { download("conversation.md", conversationToMarkdown(activeConvo), "text/markdown"); setMenu(false); }} />
                    <div className="my-1 border-t border-[#eceef9]" />
                    <Row icon={Trash2} label="Delete" danger onClick={() => { onDelete(activeConvo.id); setMenu(false); }} />
                  </div>
                </>
              )}
            </div>

            <button
              onClick={onNewChat}
              className="flex items-center gap-1.5 bg-[var(--oo-primary)] text-white text-[12px] font-bold rounded-lg px-3.5 py-2 hover:brightness-105 transition-all cursor-pointer shrink-0"
            >
              <Plus size={14} /> New Chat
            </button>
          </div>

          {/* Chat body — the generated dashboard renders here and scrolls if taller than the view */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-5 min-h-0">
            <ChatView
              messages={messages}
              onAsk={onAsk}
              onRegenerate={onRegenerate}
              lang={lang}
              isThinking={isThinking}
            />
          </div>

          {/* Prompt bar — fixed at the BOTTOM, Claude-style: describe a dashboard to generate it. */}
          <div className="shrink-0 border-t border-[#eceef9] px-4 pt-3 pb-2 bg-white">
            <div className="max-w-3xl mx-auto w-full">{composer}</div>
            <div className="text-center text-[10px] text-[var(--oo-muted)] mt-2">
              Let us learn — AI assistant · every number is grounded in the database
            </div>
          </div>
        </section>
      </div>

      {share && (
        <SharePopup
          url={`${location.origin}/shared/chat/${activeConvo.id}`}
          title="Share this conversation"
          preview={firstQuestion ? `Q: ${firstQuestion}` : activeConvo.title}
          shareText={conversationToMarkdown(activeConvo)}
          onClose={() => setShare(false)}
        />
      )}

      {summary && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={() => setSummary(null)}>
          <div className="bg-white w-full max-w-lg max-h-[80vh] flex flex-col" style={{ borderRadius: "16px", boxShadow: "0 20px 60px -20px rgba(0,0,0,.5)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#eceef9]">
              <div className="flex items-center gap-2"><ScrollText size={16} className="text-[var(--oo-primary)]" /><h3 className="font-head text-[15px] font-semibold text-[var(--oo-heading)]">Conversation summary</h3></div>
              <button onClick={() => setSummary(null)} className="text-[var(--oo-muted)] hover:text-[var(--oo-heading)] cursor-pointer" aria-label="Close"><X size={16} /></button>
            </div>
            <div className="p-5 overflow-y-auto no-scrollbar">
              {summary.md.split("\n").map((line, i) => {
                if (line.startsWith("# ")) return <h3 key={i} className="font-head text-[16px] font-bold text-[var(--oo-heading)] mb-1">{line.slice(2)}</h3>;
                if (line.startsWith("_")) return <div key={i} className="text-[11px] text-[var(--oo-muted)] mb-3">{line.replace(/_/g, "")}</div>;
                if (line.startsWith("- ")) return <div key={i} className="flex gap-2 text-[13px] text-[var(--oo-text)] mb-1.5 leading-relaxed"><span className="text-[var(--oo-primary)] font-bold">•</span><span>{line.slice(2).replace(/\*\*/g, "")}</span></div>;
                return line.trim() ? <div key={i} className="text-[13px] text-[var(--oo-text)]">{line}</div> : null;
              })}
            </div>
            <div className="flex gap-2 justify-end px-5 py-3 border-t border-[#eceef9]">
              <button onClick={() => { try { navigator.clipboard?.writeText(summary.md); } catch { /* clipboard */ } }} className="text-[12px] font-semibold text-[var(--oo-text)] border border-[#e3e6f8] rounded-lg px-3 py-1.5 hover:border-[var(--oo-primary)] cursor-pointer">Copy</button>
              <button onClick={() => download("summary.md", summary.md, "text/markdown")} className="text-[12px] font-semibold text-[var(--oo-text)] border border-[#e3e6f8] rounded-lg px-3 py-1.5 hover:border-[var(--oo-primary)] cursor-pointer">.md</button>
              <button onClick={() => printHtml(summary.html, "Summary")} className="text-[12px] font-semibold text-white bg-[var(--oo-primary)] rounded-lg px-3 py-1.5 hover:brightness-105 cursor-pointer">Print / PDF</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--oo-muted)] hover:text-[var(--oo-primary)] hover:bg-[#f4f5fd] transition-colors cursor-pointer shrink-0"
    >
      {children}
    </button>
  );
}

function Row({ icon: Icon, label, onClick, danger }: { icon: typeof Pin; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] transition-colors cursor-pointer ${
        danger ? "text-[var(--oo-danger)] hover:bg-[var(--oo-danger)]/8" : "text-[var(--oo-text)] hover:bg-[#f4f5fd]"
      }`}
    >
      <Icon size={13} className={`shrink-0 ${danger ? "" : "text-[var(--oo-muted)]"}`} />
      {label}
    </button>
  );
}

export default CopilotPanel;
