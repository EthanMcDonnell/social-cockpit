"use client";

import { useState, useRef } from "react";
import { clsx } from "clsx";
import type { AutomationFlow, CommentToDmConfig } from "@/lib/db";
import {
  useAutomationFlows,
  useCreateFlow,
  useUpdateFlow,
  useDeleteFlow,
} from "@/hooks/useAutomationFlows";
import { useMedia } from "@/hooks/useMedia";
import type { InstagramMedia } from "@/lib/instagram/types";

// ─── Default config ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CommentToDmConfig = {
  initial_message:
    "Hey! Thanks for your comment — I'll DM you the details right now.",
  not_following_message:
    "To receive the link, please follow us first! Once you do, just reply here and I'll send it over.",
  following_message: "Thanks for following! Here's your link: {{link}}",
};

// ─── Icons ─────────────────────────────────────────────────────────────────────

function IconComment() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M17.5 12.5a2.5 2.5 0 0 1-2.5 2.5H5.833L2.5 17.5V5a2.5 2.5 0 0 1 2.5-2.5h10a2.5 2.5 0 0 1 2.5 2.5v7.5z" />
    </svg>
  );
}

function IconDM() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M2.5 3.5h15v10h-15z" />
      <path d="M2.5 3.5l7.5 6.25 7.5-6.25" />
    </svg>
  );
}

function IconWait() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6v4l2.5 2.5" />
    </svg>
  );
}

function IconFollow() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <circle cx="8" cy="6.5" r="3" />
      <path d="M2.5 17.5c0-3.314 2.462-6 5.5-6s5.5 2.686 5.5 6" />
      <path d="M14.5 9l1.5 1.5 3-3" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M17.5 2.5L9.5 10.5M17.5 2.5L12.5 17.5l-3-7-7-3 15-5z" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4">
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M3.5 5.5h13M8.5 5.5V4h3v1.5M15.5 5.5l-.833 10H5.333L4.5 5.5" />
    </svg>
  );
}

function IconX() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" className="w-2.5 h-2.5">
      <path d="M2 2l8 8M10 2l-8 8" />
    </svg>
  );
}

// ─── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0",
        checked ? "bg-accent-cyan" : "bg-border"
      )}
      aria-pressed={checked}
    >
      <span
        className={clsx(
          "absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

// ─── Keyword tag input ─────────────────────────────────────────────────────────

function KeywordTagInput({
  keywords,
  onChange,
}: {
  keywords: string[];
  onChange: (kws: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function commit(raw: string) {
    const kw = raw.trim().toUpperCase();
    if (kw && !keywords.includes(kw)) {
      onChange([...keywords, kw]);
    }
    setDraft("");
  }

  function remove(kw: string) {
    onChange(keywords.filter((k) => k !== kw));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && keywords.length > 0) {
      remove(keywords[keywords.length - 1]);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    e.clipboardData
      .getData("text")
      .split(/[,\s]+/)
      .filter(Boolean)
      .forEach(commit);
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className="flex flex-wrap gap-1.5 min-h-[38px] bg-bg-base border border-border rounded-xl px-2.5 py-2 focus-within:border-accent-cyan/40 transition-colors cursor-text"
    >
      {keywords.map((kw) => (
        <span
          key={kw}
          className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold px-2 py-0.5 rounded-lg bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20"
        >
          {kw}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); remove(kw); }}
            className="hover:text-accent-red transition-colors"
            aria-label={`Remove ${kw}`}
          >
            <IconX />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={() => draft && commit(draft)}
        placeholder={keywords.length === 0 ? "Type a keyword and press Enter…" : ""}
        className="flex-1 min-w-[120px] text-xs bg-transparent text-text-primary placeholder:text-text-muted/40 focus:outline-none"
      />
    </div>
  );
}

// ─── Flow connector ────────────────────────────────────────────────────────────

function Connector({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center py-1 select-none">
      <div className="w-px h-4 bg-border" />
      {label && (
        <span className="text-[10px] font-mono text-text-muted/60 uppercase tracking-wider px-1.5 py-0.5 bg-bg-base rounded border border-border">
          {label}
        </span>
      )}
      <div className="w-px h-4 bg-border" />
      <svg className="w-2 h-2 text-border -mt-0.5" viewBox="0 0 8 8" fill="currentColor">
        <path d="M4 8L0 0h8L4 8z" />
      </svg>
    </div>
  );
}

// ─── Step card ─────────────────────────────────────────────────────────────────

function StepCard({
  icon,
  label,
  color,
  children,
  readonly,
}: {
  icon: React.ReactNode;
  label: string;
  color: "cyan" | "amber" | "green" | "purple" | "indigo";
  children?: React.ReactNode;
  readonly?: boolean;
}) {
  const iconCls = {
    cyan: "text-accent-cyan",
    amber: "text-accent-amber",
    green: "text-accent-green",
    purple: "text-[var(--chart-3)]",
    indigo: "text-[var(--chart-2)]",
  };

  return (
    <div className="rounded-2xl border border-border bg-bg-card p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <span className={clsx("w-5 h-5 flex items-center justify-center flex-shrink-0", iconCls[color])}>
          {icon}
        </span>
        <span className="text-xs font-medium uppercase tracking-widest text-text-muted">
          {label}
        </span>
      </div>
      {readonly ? (
        <p className="text-xs text-text-muted/50 italic">Automatic — no configuration needed</p>
      ) : (
        children
      )}
    </div>
  );
}

// ─── Message textarea ──────────────────────────────────────────────────────────

function MessageField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  focusColor = "cyan",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  focusColor?: "cyan" | "red" | "green";
}) {
  const focusCls = {
    cyan: "focus:border-accent-cyan/50",
    red: "focus:border-accent-red/50",
    green: "focus:border-accent-green/50",
  };
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] text-text-muted uppercase tracking-wider font-medium">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className={clsx(
          "w-full text-xs bg-bg-base border border-border rounded-xl px-3 py-2.5 text-text-primary placeholder:text-text-muted/40 resize-none focus:outline-none transition-colors",
          focusCls[focusColor]
        )}
      />
      {hint && <p className="text-[10px] text-text-muted/55 leading-relaxed">{hint}</p>}
    </div>
  );
}

// ─── Video selector ────────────────────────────────────────────────────────────

function VideoSelector({
  selectedId,
  onChange,
}: {
  selectedId: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const { data, isLoading } = useMedia({ limit: 20 });
  const items = data?.data ?? [];

  function thumb(m: InstagramMedia) {
    return m.thumbnail_url ?? m.media_url ?? null;
  }

  return (
    <div className="space-y-1.5 mb-5">
      <label className="block text-[10px] text-text-muted uppercase tracking-wider font-medium">
        Apply to
      </label>
      {isLoading ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="w-16 h-16 flex-shrink-0 rounded-xl bg-border/50 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className={clsx(
              "flex-shrink-0 w-16 h-16 rounded-xl border text-[10px] font-medium transition-all",
              !selectedId
                ? "border-accent-cyan bg-accent-cyan/10 text-accent-cyan"
                : "border-border bg-bg-base text-text-muted hover:border-border/80"
            )}
          >
            Any post
          </button>
          {items.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange(m.id)}
              title={m.caption?.slice(0, 80) ?? m.id}
              className={clsx(
                "flex-shrink-0 w-16 h-16 rounded-xl border overflow-hidden transition-all",
                selectedId === m.id
                  ? "border-accent-cyan ring-1 ring-accent-cyan/50"
                  : "border-border hover:border-border/80"
              )}
            >
              {thumb(m) ? (
                <img src={thumb(m)!} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-bg-card flex items-center justify-center text-[10px] text-text-muted">
                  {m.media_type === "REEL" ? "Reel" : "Post"}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
      {selectedId && (
        <p className="text-[10px] text-text-muted/55">
          Automation will only trigger on comments from the selected post.
        </p>
      )}
      {!selectedId && (
        <p className="text-[10px] text-text-muted/55">
          Automation will trigger on any post.
        </p>
      )}
    </div>
  );
}

// ─── Flow editor ───────────────────────────────────────────────────────────────

function FlowEditor({
  flow,
  onSave,
  onDelete,
  onCancel,
  isSaving,
}: {
  flow?: AutomationFlow;
  onSave: (data: { name: string; trigger_keywords: string[]; config: CommentToDmConfig; media_id?: string }) => void;
  onDelete?: () => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState(flow?.name ?? "Comment to DM");
  const [keywords, setKeywords] = useState<string[]>(
    flow?.trigger_keywords ?? ["LINK"]
  );
  const [config, setConfig] = useState<CommentToDmConfig>(
    flow?.config ?? { ...DEFAULT_CONFIG }
  );
  const [mediaId, setMediaId] = useState<string | undefined>(flow?.media_id);
  const [error, setError] = useState<string | null>(null);

  function updateConfig(key: keyof CommentToDmConfig, value: string) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    setError(null);
    if (!name.trim()) { setError("Flow name is required"); return; }
    if (keywords.length === 0) { setError("At least one trigger keyword is required"); return; }
    if (!config.initial_message.trim()) { setError("Initial message is required"); return; }
    if (!config.not_following_message.trim()) { setError("Not-following message is required"); return; }
    if (!config.following_message.trim()) { setError("Reward message is required"); return; }
    onSave({ name: name.trim(), trigger_keywords: keywords, config, media_id: mediaId });
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-1">
      {/* Flow name */}
      <div className="mb-5">
        <label className="block text-[10px] text-text-muted uppercase tracking-wider mb-1.5">
          Flow name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full text-sm font-semibold bg-bg-base border border-border rounded-xl px-3 py-2.5 text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent-cyan/40 transition-colors"
          placeholder="My automation flow"
        />
      </div>

      {/* Video selector */}
      <VideoSelector selectedId={mediaId} onChange={setMediaId} />

      {/* ── Step 1: Trigger ── */}
      <StepCard icon={<IconComment />} label="Trigger — keyword in comment" color="cyan">
        <div className="space-y-1.5">
          <label className="block text-[10px] text-text-muted uppercase tracking-wider font-medium">
            Keywords
          </label>
          <KeywordTagInput keywords={keywords} onChange={setKeywords} />
          <p className="text-[10px] text-text-muted/55 leading-relaxed">
            Type a keyword and press <kbd className="font-mono bg-bg-card border border-border px-1 py-0.5 rounded text-[9px]">Enter</kbd> or <kbd className="font-mono bg-bg-card border border-border px-1 py-0.5 rounded text-[9px]">,</kbd> to add it. Matching is case-insensitive and checks for the word anywhere in the comment.
            <br />
            <span className="text-text-muted/40">
              Note: Instagram "fancy font" variations (𝗯𝗼𝗹𝗱, 𝘪𝘵𝘢𝘭𝘪𝘤, ꜰᴜʟʟᴡɪᴅᴛʜ) use different unicode characters. Add them as separate keywords if needed.
            </span>
          </p>
        </div>
      </StepCard>

      <Connector />

      {/* ── Step 2: Send initial DM ── */}
      <StepCard icon={<IconDM />} label="Send DM" color="amber">
        <MessageField
          label="Initial message"
          value={config.initial_message}
          onChange={(v) => updateConfig("initial_message", v)}
          placeholder="Hey! Thanks for your comment..."
          hint="Use {{username}} to include the commenter's name."
        />
      </StepCard>

      <Connector />

      {/* ── Step 3: Wait for reply ── */}
      <StepCard icon={<IconWait />} label="Wait for reply" color="purple" readonly />

      <Connector />

      {/* ── Step 4: Check follow ── */}
      <StepCard icon={<IconFollow />} label="Check follow status" color="green">
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-text-muted/60 font-medium">
            If not following
          </p>
          <MessageField
            label=""
            value={config.not_following_message}
            onChange={(v) => updateConfig("not_following_message", v)}
            placeholder="Please follow us first, then reply here!"
            focusColor="red"
          />
        </div>
      </StepCard>

      <Connector label="if following" />

      {/* ── Step 5: Send reward message ── */}
      <StepCard icon={<IconSend />} label="Send message / URL" color="indigo">
        <MessageField
          label="Reward message"
          value={config.following_message}
          onChange={(v) => updateConfig("following_message", v)}
          placeholder="Here's your link: {{link}}"
          focusColor="green"
          hint="Use {{link}} for your URL and {{username}} for the person's name."
        />
      </StepCard>

      {error && <p className="text-xs text-accent-red pt-1">{error}</p>}

      <div className="flex items-center gap-2 pt-4 pb-2">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex-1 text-sm font-medium px-4 py-2.5 rounded-xl bg-accent-cyan text-bg-base hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isSaving ? "Saving…" : flow ? "Save changes" : "Create flow"}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2.5 rounded-xl text-sm text-text-muted hover:text-text-primary hover:bg-bg-card transition-colors border border-border"
        >
          Cancel
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            className="w-10 h-10 flex items-center justify-center rounded-xl text-text-muted hover:text-accent-red hover:bg-accent-red/10 transition-colors border border-border"
            title="Delete flow"
          >
            <IconTrash />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Template picker ───────────────────────────────────────────────────────────

function TemplatePicker({ onSelect }: { onSelect: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 py-12">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center mb-6">
          <h2 className="font-heading text-base font-semibold text-text-primary mb-1">
            Choose a template
          </h2>
          <p className="text-xs text-text-muted">Start with a pre-built flow.</p>
        </div>

        <button
          onClick={onSelect}
          className="w-full text-left p-4 rounded-2xl border border-border hover:border-accent-cyan/40 hover:bg-accent-cyan/[0.04] transition-all group"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-accent-cyan">
                <path d="M17.5 12.5a2.5 2.5 0 0 1-2.5 2.5H5.833L2.5 17.5V5a2.5 2.5 0 0 1 2.5-2.5h10a2.5 2.5 0 0 1 2.5 2.5v7.5z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary group-hover:text-accent-cyan transition-colors">
                Comment to DM
              </p>
              <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
                Keyword in comment → DM → wait for reply → check follow → send link or ask to follow first.
              </p>
              <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                {["Keyword trigger", "DM", "Follow check", "Branch"].map((tag) => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded bg-bg-card border border-border text-text-muted">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── Flow list item ────────────────────────────────────────────────────────────

function FlowRow({
  flow,
  isSelected,
  onSelect,
  onToggle,
}: {
  flow: AutomationFlow;
  isSelected: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={clsx(
        "w-full text-left p-3 rounded-xl border transition-all",
        isSelected
          ? "border-accent-cyan/30 bg-accent-cyan/[0.07]"
          : "border-border hover:bg-bg-card/50"
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <p className={clsx("text-sm font-medium truncate", isSelected ? "text-accent-cyan" : "text-text-primary")}>
            {flow.name}
          </p>
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            {flow.trigger_keywords.map((kw) => (
              <span key={kw} className="text-[10px] font-mono text-text-muted/70 bg-bg-base border border-border px-1.5 py-0.5 rounded">
                {kw}
              </span>
            ))}
          </div>
        </div>
        <div
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="mt-0.5"
        >
          <Toggle checked={flow.is_active} onChange={() => onToggle()} />
        </div>
      </div>
      {flow.is_active && (
        <div className="mt-1.5 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
          <span className="text-[10px] text-accent-green">Active</span>
        </div>
      )}
    </button>
  );
}

// ─── Main client ───────────────────────────────────────────────────────────────

type EditorState =
  | { mode: "idle" }
  | { mode: "pick-template" }
  | { mode: "new" }
  | { mode: "edit"; flow: AutomationFlow };

export function AutomationsClient() {
  const { data: flows, isLoading } = useAutomationFlows();
  const create = useCreateFlow();
  const update = useUpdateFlow();
  const del = useDeleteFlow();

  const [editor, setEditor] = useState<EditorState>({ mode: "idle" });
  const selectedFlowId = editor.mode === "edit" ? editor.flow.id : null;

  async function handleSave(data: {
    name: string;
    trigger_keywords: string[];
    config: CommentToDmConfig;
    media_id?: string;
  }) {
    if (editor.mode === "new") {
      await create.mutateAsync(data);
    } else if (editor.mode === "edit") {
      await update.mutateAsync({ id: editor.flow.id, ...data });
    }
    setEditor({ mode: "idle" });
  }

  async function handleDelete() {
    if (editor.mode !== "edit") return;
    if (!confirm(`Delete "${editor.flow.name}"?`)) return;
    await del.mutateAsync(editor.flow.id);
    setEditor({ mode: "idle" });
  }

  function handleToggle(flow: AutomationFlow) {
    update.mutate({ id: flow.id, is_active: !flow.is_active });
  }

  const isSaving = create.isPending || update.isPending;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Left panel ── */}
      <div className="w-72 flex-shrink-0 border-r border-border flex flex-col overflow-hidden">
        <div className="h-12 px-4 flex items-center justify-between border-b border-border flex-shrink-0">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-widest">Flows</span>
          <button
            onClick={() => setEditor({ mode: "pick-template" })}
            className="flex items-center gap-1.5 text-xs font-medium text-accent-cyan hover:opacity-80 transition-opacity"
          >
            <IconPlus />
            New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {isLoading && [1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-border/50 animate-pulse" />
          ))}

          {!isLoading && flows?.length === 0 && editor.mode === "idle" && (
            <div className="text-center py-10">
              <p className="text-xs text-text-muted leading-relaxed">
                No flows yet.
                <br />
                <button
                  onClick={() => setEditor({ mode: "pick-template" })}
                  className="text-accent-cyan hover:underline mt-1 block mx-auto"
                >
                  Create your first flow →
                </button>
              </p>
            </div>
          )}

          {flows?.map((flow) => (
            <FlowRow
              key={flow.id}
              flow={flow}
              isSelected={flow.id === selectedFlowId}
              onSelect={() => setEditor({ mode: "edit", flow })}
              onToggle={() => handleToggle(flow)}
            />
          ))}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {editor.mode === "idle" && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-text-muted">
              Select a flow to edit or{" "}
              <button onClick={() => setEditor({ mode: "pick-template" })} className="text-accent-cyan hover:underline">
                create a new one
              </button>.
            </p>
          </div>
        )}

        {editor.mode === "pick-template" && (
          <TemplatePicker onSelect={() => setEditor({ mode: "new" })} />
        )}

        {(editor.mode === "new" || editor.mode === "edit") && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="h-12 px-6 flex items-center gap-3 border-b border-border flex-shrink-0">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-widest">
                {editor.mode === "new" ? "New flow" : "Edit flow"}
              </span>
              {editor.mode === "edit" && (
                <>
                  <span className="text-border">·</span>
                  <Toggle
                    checked={editor.flow.is_active}
                    onChange={(v) => {
                      update.mutate({ id: editor.flow.id, is_active: v });
                      setEditor({ mode: "edit", flow: { ...editor.flow, is_active: v } });
                    }}
                  />
                  <span className="text-xs text-text-muted">
                    {editor.flow.is_active ? "Active" : "Inactive"}
                  </span>
                </>
              )}
            </div>

            {editor.mode === "new" ? (
              <FlowEditor
                onSave={handleSave}
                onCancel={() => setEditor({ mode: "idle" })}
                isSaving={isSaving}
              />
            ) : (
              <FlowEditor
                flow={editor.flow}
                onSave={handleSave}
                onDelete={handleDelete}
                onCancel={() => setEditor({ mode: "idle" })}
                isSaving={isSaving}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
