import { useState } from "react";
import { X, Link2, Check, Copy, Share2 } from "lucide-react";

/**
 * Share modal. With no backend to host a shared page, real sharing = sharing the CONTENT: "Copy
 * answer" copies the full answer/conversation as Markdown (paste anywhere), and "Share…" uses the
 * device's native share sheet when available. The link + socials remain as a labeled placeholder.
 */
export function SharePopup({
  url,
  title,
  onClose,
  preview,
  shareText,
}: {
  url: string;
  title: string;
  onClose: () => void;
  preview?: string;
  shareText?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copiedC, setCopiedC] = useState(false);
  const enc = encodeURIComponent(url);
  const txt = encodeURIComponent(title);
  const content = shareText ?? preview ?? title;
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copyContent = () => {
    try { navigator.clipboard?.writeText(content); } catch { /* clipboard unavailable */ }
    setCopiedC(true);
    setTimeout(() => setCopiedC(false), 1600);
  };
  const nativeShare = async () => {
    try { await navigator.share({ title, text: content }); } catch { /* dismissed / unsupported */ }
  };

  const socials: { name: string; href: string; bg: string; glyph: string }[] = [
    { name: "X", href: `https://twitter.com/intent/tweet?url=${enc}&text=${txt}`, bg: "#0f1419", glyph: "𝕏" },
    { name: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc}`, bg: "#0a66c2", glyph: "in" },
    { name: "Reddit", href: `https://www.reddit.com/submit?url=${enc}&title=${txt}`, bg: "#ff4500", glyph: "r/" },
  ];

  const copyLink = () => {
    try {
      navigator.clipboard?.writeText(url);
    } catch {
      /* clipboard unavailable */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-md p-6"
        style={{ borderRadius: "var(--oo-card-radius)", boxShadow: "var(--oo-card-shadow)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-head text-[17px] font-semibold text-[var(--oo-heading)]">{title}</h2>
          <button onClick={onClose} className="text-[var(--oo-muted)] hover:text-[var(--oo-heading)] cursor-pointer" aria-label="Close">
            <X size={17} />
          </button>
        </div>

        {preview && (
          <div
            className="text-[12px] text-[var(--oo-text)] leading-relaxed bg-[var(--oo-canvas)] border border-[var(--oo-border)] rounded-md p-3 mb-4 max-h-32 overflow-y-auto"
          >
            {preview}
          </div>
        )}

        {/* Real sharing: the content itself */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={copyContent}
            className="flex-1 flex items-center justify-center gap-2 bg-[var(--oo-primary)] text-white rounded-md px-3 py-2.5 font-semibold text-[13px] hover:brightness-105 transition-all cursor-pointer"
          >
            {copiedC ? <Check size={15} /> : <Copy size={15} />}
            {copiedC ? "Copied" : "Copy answer"}
          </button>
          {canNativeShare && (
            <button
              onClick={nativeShare}
              className="flex items-center justify-center gap-2 border border-[var(--oo-input-border)] rounded-md px-4 py-2.5 font-semibold text-[13px] text-[var(--oo-text)] hover:border-[var(--oo-primary)] transition-colors cursor-pointer"
            >
              <Share2 size={15} /> Share…
            </button>
          )}
        </div>

        <button
          onClick={copyLink}
          className="w-full flex items-center gap-2 border border-[var(--oo-input-border)] rounded-md px-3 py-2.5 mb-5 hover:border-[var(--oo-primary)] transition-colors cursor-pointer"
        >
          {copied ? <Check size={15} className="text-[var(--oo-success)]" /> : <Link2 size={15} className="text-[var(--oo-muted)]" />}
          <span className="text-[12px] text-[var(--oo-text)] truncate flex-1 text-left">{url}</span>
          <span className={`text-[12px] font-semibold shrink-0 ${copied ? "text-[var(--oo-success)]" : "text-[var(--oo-primary)]"}`}>
            {copied ? "Copied" : "Copy link"}
          </span>
        </button>

        <div className="flex items-center justify-center gap-6">
          {socials.map((s) => (
            <a
              key={s.name}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-1.5 group"
            >
              <span
                className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-[15px] group-hover:brightness-110 transition-all"
                style={{ background: s.bg }}
              >
                {s.glyph}
              </span>
              <span className="text-[11px] text-[var(--oo-muted)]">{s.name}</span>
            </a>
          ))}
        </div>

        <p className="text-[10.5px] text-[var(--oo-muted)] text-center mt-5">
          Sharing link is a placeholder — a backend is needed to open shared conversations for other users.
        </p>
      </div>
    </div>
  );
}

export default SharePopup;
