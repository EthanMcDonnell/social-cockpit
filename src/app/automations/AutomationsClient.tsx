"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import type { AutomationFlow, AutomationConfig, CommentToDmConfig, CommentToReplyConfig, CommentToFollowDmConfig, AutomationTemplateType } from "@/lib/db";
import {
  useAutomationFlows,
  useCreateFlow,
  useUpdateFlow,
  useDeleteFlow,
} from "@/hooks/useAutomationFlows";
import { useMedia } from "@/hooks/useMedia";
import type { InstagramMedia } from "@/lib/instagram/types";
import { ApiUsageMeter } from "@/components/automations/ApiUsageMeter";

// ─── Default configs ───────────────────────────────────────────────────────────

const DEFAULT_DM_CONFIG: CommentToDmConfig = {
  comment_reply_fn: "",
  comment_replies: [],
  initial_message: "Hey! Thanks for your comment — here's the link: https://",
};

const DEFAULT_REPLY_CONFIG: CommentToReplyConfig = {
  comment_reply_fn: "",
  comment_replies: [],
};

const DEFAULT_FOLLOW_DM_CONFIG: CommentToFollowDmConfig = {
  comment_reply_fn: "",
  comment_replies: [],
  confirm_keyword: "DONE",
  dm_pack: "casual",
  opener_message: "",
  not_following_message: "",
  follower_message: "Here you go! Here's the link: https://",
  resource: "resources",
  on_check_error: "follow_prompt",
};

// ─── Reply functions hook ──────────────────────────────────────────────────────

interface ReplyFunctionDef {
  name: string;
  preview: string;
}

function useReplyFunctions() {
  return useQuery<ReplyFunctionDef[]>({
    queryKey: ["automation-reply-functions"],
    queryFn: async () => {
      const res = await fetch("/api/automation-reply-functions");
      if (!res.ok) throw new Error("Failed to fetch reply functions");
      return res.json();
    },
    staleTime: 60_000,
  });
}

// ─── DM message packs hook (comment_to_follow_dm) ───────────────────────────────

interface DmPackDef {
  name: string;
  opener: string;
  nudge: string;
}

function useDmPacks() {
  return useQuery<DmPackDef[]>({
    queryKey: ["follow-dm-functions"],
    queryFn: async () => {
      const res = await fetch("/api/follow-dm-functions");
      if (!res.ok) throw new Error("Failed to fetch DM packs");
      return res.json();
    },
    staleTime: 60_000,
  });
}

// ─── Warn+error badge for the logs link ─────────────────────────────────────────

function useEventIssueCount() {
  return useQuery<number>({
    queryKey: ["automation-events-issues"],
    queryFn: async () => {
      const res = await fetch("/api/automation-events?level=warn,error&limit=1");
      if (!res.ok) return 0;
      const data = await res.json();
      return (data?.counts?.warn ?? 0) + (data?.counts?.error ?? 0);
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

// ─── Per-flow funnel counters (Phase 2) ─────────────────────────────────────────

interface FlowStats {
  // Count of DMs sent (opener_sent). Reads as "invited" for a follow funnel,
  // where the opener is an invitation to follow, and plainly as "sent" for
  // comment_to_dm — same underlying number, different domain meaning.
  invited: number;
  rewarded: number;
  nudged: number;
  expired: number;
}

function useAutomationStats() {
  return useQuery<Record<string, FlowStats>>({
    queryKey: ["automation-stats"],
    queryFn: async () => {
      const res = await fetch("/api/automation-stats");
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

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

// ─── Logs link (with warn+error badge) ──────────────────────────────────────────

function LogsLink() {
  const { data: issues } = useEventIssueCount();
  return (
    <Link
      href="/automations/logs"
      className="flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text-primary transition-colors"
    >
      Logs
      {issues && issues > 0 ? (
        <span className="min-w-[16px] h-4 px-1 rounded-full bg-accent-red text-white text-[9px] font-semibold flex items-center justify-center">
          {issues > 99 ? "99+" : issues}
        </span>
      ) : null}
    </Link>
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

// ─── Comment replies field ─────────────────────────────────────────────────────

function CommentRepliesField({
  replies,
  onChange,
}: {
  replies: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const trimmed = draft.trim();
    if (trimmed && !replies.includes(trimmed)) onChange([...replies, trimmed]);
    setDraft("");
  }

  function remove(i: number) {
    onChange(replies.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {replies.map((r, i) => (
          <div key={i} className="flex items-start gap-2 group">
            <input
              value={r}
              onChange={(e) => {
                const next = [...replies];
                next[i] = e.target.value;
                onChange(next);
              }}
              className="flex-1 text-xs bg-bg-base border border-border rounded-xl px-3 py-2 text-text-primary focus:outline-none focus:border-accent-cyan/50 transition-colors"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="mt-2 text-text-muted hover:text-accent-red transition-colors opacity-0 group-hover:opacity-100"
            >
              <IconX />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Add a reply option…"
          className="flex-1 text-xs bg-bg-base border border-border rounded-xl px-3 py-2 text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent-cyan/50 transition-colors"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="px-3 py-2 rounded-xl text-xs font-medium bg-bg-card border border-border text-text-muted hover:text-accent-cyan hover:border-accent-cyan/40 disabled:opacity-40 transition-colors"
        >
          Add
        </button>
      </div>
      <p className="text-[10px] text-text-muted/55">One reply chosen at random. Use {"{{username}}"} for the commenter&apos;s name.</p>
    </div>
  );
}

// ─── Reply function selector ───────────────────────────────────────────────────

function ReplyFunctionSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { data: fns, isLoading } = useReplyFunctions();

  if (isLoading) {
    return <div className="h-10 rounded-xl bg-border/50 animate-pulse" />;
  }

  if (!fns || fns.length === 0) {
    return (
      <div className="space-y-1.5">
        <label className="block text-[10px] text-text-muted uppercase tracking-wider font-medium">
          Reply function
        </label>
        <p className="text-xs text-text-muted/60 italic">
          No functions defined. Add them to{" "}
          <code className="font-mono text-[11px] bg-bg-card border border-border px-1 rounded">
            src/lib/comment-reply-functions.ts
          </code>
        </p>
      </div>
    );
  }

  const selected = fns.find((f) => f.name === value) ?? fns[0];

  return (
    <div className="space-y-2">
      <label className="block text-[10px] text-text-muted uppercase tracking-wider font-medium">
        Reply function
      </label>
      <select
        value={value || fns[0].name}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs bg-bg-base border border-border rounded-xl px-3 py-2.5 text-text-primary focus:outline-none focus:border-accent-cyan/50 transition-colors appearance-none"
      >
        {fns.map((f) => (
          <option key={f.name} value={f.name}>
            {f.name}
          </option>
        ))}
      </select>
      {selected && (
        <p className="text-[10px] text-text-muted/60 font-mono leading-relaxed pl-0.5">
          Preview: &ldquo;{selected.preview}&rdquo;
        </p>
      )}
      <p className="text-[10px] text-text-muted/55">
        Functions are defined in{" "}
        <code className="font-mono bg-bg-card border border-border px-1 rounded">
          src/lib/comment-reply-functions.ts
        </code>
      </p>
    </div>
  );
}

// ─── Video selector ────────────────────────────────────────────────────────────

function VideoSelector({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data, isLoading } = useMedia({ limit: 20 });
  const items = data?.data ?? [];

  function thumb(m: InstagramMedia) {
    if (m.media_type === "IMAGE") return m.media_url ?? null;
    return m.thumbnail_url ?? null;
  }

  function toggle(id: string) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id]
    );
  }

  const count = selectedIds.length;

  // Selected posts float to the front so they stay visible even when they're
  // older than the current scroll window. Order within each group is stable.
  const orderedItems = [
    ...items.filter((m) => selectedIds.includes(m.id)),
    ...items.filter((m) => !selectedIds.includes(m.id)),
  ];

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
            onClick={() => onChange([])}
            className={clsx(
              "flex-shrink-0 w-16 h-16 rounded-xl border text-[10px] font-medium transition-all",
              count === 0
                ? "border-accent-cyan bg-accent-cyan/10 text-accent-cyan"
                : "border-border bg-bg-base text-text-muted hover:border-border/80"
            )}
          >
            Any post
          </button>
          {orderedItems.map((m) => {
            const isSelected = selectedIds.includes(m.id);
            return (
            <div key={m.id} className="flex-shrink-0 flex flex-col items-center gap-1 w-16">
              <button
                type="button"
                onClick={() => toggle(m.id)}
                className={clsx(
                  "relative w-16 h-16 rounded-xl border overflow-hidden transition-all",
                  isSelected
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
                {isSelected && (
                  <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-accent-cyan text-bg-base flex items-center justify-center">
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
                      <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                    </svg>
                  </span>
                )}
              </button>
              <p className="text-[9px] text-text-muted/60 text-center leading-tight line-clamp-2 w-full">
                {m.caption?.slice(0, 30) ?? m.media_type}
              </p>
            </div>
          );
          })}
        </div>
      )}
      {count > 0 ? (
        <p className="text-[10px] text-text-muted/55">
          Automation will only trigger on comments from {count === 1 ? "the selected post" : `the ${count} selected posts`}. Tap a post to add or remove it.
        </p>
      ) : (
        <p className="text-[10px] text-text-muted/55">
          Automation will trigger on any post.
        </p>
      )}
    </div>
  );
}

// ─── Single-line text field ─────────────────────────────────────────────────────

function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] text-text-muted uppercase tracking-wider font-medium">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={clsx(
          "w-full text-xs bg-bg-base border border-border rounded-xl px-3 py-2.5 text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent-cyan/50 transition-colors",
          mono && "font-mono"
        )}
      />
      {hint && <p className="text-[10px] text-text-muted/55 leading-relaxed">{hint}</p>}
    </div>
  );
}

// ─── DM pack selector (comment_to_follow_dm) ─────────────────────────────────────

function DmPackSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { data: packs, isLoading } = useDmPacks();

  if (isLoading) return <div className="h-10 rounded-xl bg-border/50 animate-pulse" />;

  if (!packs || packs.length === 0) {
    return (
      <p className="text-xs text-text-muted/60 italic">
        No packs defined. Add them to{" "}
        <code className="font-mono text-[11px] bg-bg-card border border-border px-1 rounded">
          src/lib/follow-dm-functions.ts
        </code>
      </p>
    );
  }

  const selected = packs.find((p) => p.name === value) ?? packs[0];

  return (
    <div className="space-y-2">
      <select
        value={value || packs[0].name}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs bg-bg-base border border-border rounded-xl px-3 py-2.5 text-text-primary focus:outline-none focus:border-accent-cyan/50 transition-colors appearance-none"
      >
        {packs.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
      {selected && (
        <div className="space-y-1 pl-0.5">
          <p className="text-[10px] text-text-muted/60 font-mono leading-relaxed">
            Opener: &ldquo;{selected.opener}&rdquo;
          </p>
          <p className="text-[10px] text-text-muted/60 font-mono leading-relaxed">
            Nudge: &ldquo;{selected.nudge}&rdquo;
          </p>
        </div>
      )}
      <p className="text-[10px] text-text-muted/55">
        Packs generate randomized opener + nudge copy. Use {"{{resource}}"} inside a pack; set the
        resource name below. Reward stays manual.
      </p>
    </div>
  );
}

// ─── Follow-DM funnel fields ─────────────────────────────────────────────────────

function FollowDmFields({
  config,
  onChange,
}: {
  config: CommentToFollowDmConfig;
  onChange: (patch: Partial<CommentToFollowDmConfig>) => void;
}) {
  const [copyMode, setCopyMode] = useState<"pack" | "manual">(
    () => (config.dm_pack ? "pack" : "manual")
  );

  function switchCopyMode(mode: "pack" | "manual") {
    setCopyMode(mode);
    if (mode === "pack") {
      onChange({ dm_pack: config.dm_pack || "casual" });
    } else {
      onChange({ dm_pack: "" });
    }
  }

  return (
    <>
      <Connector label="follow gate" />

      {/* Opener DM + confirm keyword */}
      <StepCard icon={<IconDM />} label="Opener DM + confirm keyword" color="amber">
        <div className="space-y-4">
          <TextField
            label="Confirm keyword — users reply this to unlock the reward"
            value={config.confirm_keyword ?? ""}
            onChange={(v) => onChange({ confirm_keyword: v })}
            placeholder="DONE"
            mono
            hint="The opener asks the user to follow, then reply this word. That reply is what confirms them and opens the window for the reward — so keep it in the opener copy below."
          />

          {/* DM copy: pack vs manual */}
          <div className="space-y-2">
            <label className="block text-[10px] text-text-muted uppercase tracking-wider font-medium">
              Opener &amp; nudge copy
            </label>
            <div className="flex gap-1 p-0.5 bg-bg-base border border-border rounded-xl w-fit">
              <button
                type="button"
                onClick={() => switchCopyMode("pack")}
                className={clsx(
                  "px-3 py-1.5 rounded-[10px] text-[10px] font-medium transition-all",
                  copyMode === "pack" ? "bg-bg-card text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
                )}
              >
                Pack
              </button>
              <button
                type="button"
                onClick={() => switchCopyMode("manual")}
                className={clsx(
                  "px-3 py-1.5 rounded-[10px] text-[10px] font-medium transition-all",
                  copyMode === "manual" ? "bg-bg-card text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
                )}
              >
                Manual
              </button>
            </div>

            {copyMode === "pack" ? (
              <DmPackSelector value={config.dm_pack ?? ""} onChange={(v) => onChange({ dm_pack: v })} />
            ) : (
              <div className="space-y-3">
                <MessageField
                  label="Opener message"
                  value={config.opener_message ?? ""}
                  onChange={(v) => onChange({ opener_message: v })}
                  placeholder="Follow me, then reply DONE and I'll send it 🔗"
                  hint="The card's text. Tell them to follow then reply the keyword. Use {{username}}, {{resource}} and {{keyword}}."
                />
                <MessageField
                  label="Not-following message (nudge)"
                  value={config.not_following_message ?? ""}
                  onChange={(v) => onChange({ not_following_message: v })}
                  placeholder="Just need you to follow first, then reply DONE again"
                  hint="Sent when they reply the keyword but aren't following yet. Use {{keyword}}."
                />
              </div>
            )}
          </div>

          <TextField
            label="Resource name — {{resource}}"
            value={config.resource ?? ""}
            onChange={(v) => onChange({ resource: v })}
            placeholder="resources"
            hint="Substituted for {{resource}} in packs and messages, e.g. “guide” or “discount code”."
          />
        </div>
      </StepCard>

      <Connector label="if following" />

      {/* Reward */}
      <StepCard icon={<IconDM />} label="Reward — sent to followers" color="green">
        <MessageField
          label="Follower message"
          value={config.follower_message ?? ""}
          onChange={(v) => onChange({ follower_message: v })}
          placeholder="Here's your link: https://..."
          hint="Sent once we confirm they follow. This is your actual link/code — kept manual. Use {{username}}."
          focusColor="green"
        />
      </StepCard>

      {/* Error policy */}
      <StepCard icon={<IconComment />} label="Follow-check policy" color="indigo">
        <div className="space-y-1.5">
          <label className="block text-[10px] text-text-muted uppercase tracking-wider font-medium">
            If follow status can&apos;t be read
          </label>
          <select
            value={config.on_check_error ?? "follow_prompt"}
            onChange={(e) => onChange({ on_check_error: e.target.value as CommentToFollowDmConfig["on_check_error"] })}
            className="w-full text-xs bg-bg-base border border-border rounded-xl px-3 py-2.5 text-text-primary focus:outline-none focus:border-accent-cyan/50 transition-colors appearance-none"
          >
            <option value="follow_prompt">Nudge to follow (fail-closed, recommended)</option>
            <option value="reward">Send the reward anyway (fail-open)</option>
            <option value="skip">Do nothing, wait for a retry</option>
          </select>
          <p className="text-[10px] text-text-muted/55 leading-relaxed">
            Follow status is only readable after the user replies, and can lag. Fail-closed nudges them to
            follow &amp; reply again.
          </p>
        </div>
      </StepCard>
    </>
  );
}

// ─── Flow editor ───────────────────────────────────────────────────────────────

function FlowEditor({
  flow,
  templateType,
  onSave,
  onDelete,
  onCancel,
  isSaving,
}: {
  flow?: AutomationFlow;
  templateType: AutomationTemplateType;
  onSave: (data: { name: string; trigger_keywords: string[]; config: AutomationConfig; media_ids: string[]; template_type: AutomationTemplateType }) => void;
  onDelete?: () => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const defaultName =
    templateType === "comment_to_reply"
      ? "Comment to Reply"
      : templateType === "comment_to_follow_dm"
        ? "Comment to Follow to DM"
        : "Comment to DM";
  const defaultConfig: AutomationConfig =
    templateType === "comment_to_reply"
      ? DEFAULT_REPLY_CONFIG
      : templateType === "comment_to_follow_dm"
        ? DEFAULT_FOLLOW_DM_CONFIG
        : DEFAULT_DM_CONFIG;
  const [name, setName] = useState(flow?.name ?? defaultName);
  const [keywords, setKeywords] = useState<string[]>(flow?.trigger_keywords ?? ["LINK"]);
  const [config, setConfig] = useState<AutomationConfig>(flow?.config ?? defaultConfig);
  const [mediaIds, setMediaIds] = useState<string[]>(flow?.media_ids ?? []);
  const [error, setError] = useState<string | null>(null);

  const isDm = templateType === "comment_to_dm";
  const isFollowDm = templateType === "comment_to_follow_dm";
  const dmConfig = config as CommentToDmConfig;
  const followConfig = config as CommentToFollowDmConfig;

  function setFollowCfg(patch: Partial<CommentToFollowDmConfig>) {
    setConfig((prev) => ({ ...prev, ...patch }));
  }

  // Determine initial reply mode from existing config
  const [replyMode, setReplyMode] = useState<"function" | "manual">(
    () => (flow?.config.comment_reply_fn ? "function" : (flow?.config.comment_replies?.length ? "manual" : "function"))
  );

  function setReplyFn(fn: string) {
    setConfig((prev) => ({ ...prev, comment_reply_fn: fn, comment_replies: [] }));
  }

  function setManualReplies(replies: string[]) {
    setConfig((prev) => ({ ...prev, comment_replies: replies, comment_reply_fn: "" }));
  }

  function setInitialMessage(msg: string) {
    setConfig((prev) => ({ ...prev, initial_message: msg }));
  }

  function switchReplyMode(mode: "function" | "manual") {
    setReplyMode(mode);
    if (mode === "function") {
      setConfig((prev) => ({ ...prev, comment_reply_fn: "", comment_replies: [] }));
    } else {
      setConfig((prev) => ({ ...prev, comment_reply_fn: "", comment_replies: prev.comment_replies ?? [] }));
    }
  }

  function handleSave() {
    setError(null);
    if (!name.trim()) { setError("Flow name is required"); return; }
    if (keywords.length === 0) { setError("At least one trigger keyword is required"); return; }
    if (isDm && !dmConfig.initial_message?.trim()) { setError("DM message is required"); return; }
    if (isFollowDm) {
      const hasOpener = followConfig.dm_pack?.trim() || followConfig.opener_message?.trim();
      if (!hasOpener) { setError("An opener message or a message pack is required"); return; }
      if (!followConfig.follower_message?.trim()) { setError("A follower reward message is required"); return; }
    }
    onSave({ name: name.trim(), trigger_keywords: keywords, config, media_ids: mediaIds, template_type: templateType });
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
      <VideoSelector selectedIds={mediaIds} onChange={setMediaIds} />

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
              Note: Instagram &quot;fancy font&quot; variations (𝗯𝗼𝗹𝗱, 𝘪𝘵𝘢𝘭𝘪𝘤, ꜰᴜʟʟᴡɪᴅᴛʜ) use different unicode characters. Add them as separate keywords if needed.
            </span>
          </p>
        </div>
      </StepCard>

      <Connector />

      {/* ── Step 2: Reply to comment ── */}
      <StepCard icon={<IconComment />} label="Reply to comment" color="purple">
        <div className="space-y-3">
          {/* Mode toggle */}
          <div className="flex gap-1 p-0.5 bg-bg-base border border-border rounded-xl w-fit">
            <button
              type="button"
              onClick={() => switchReplyMode("function")}
              className={clsx(
                "px-3 py-1.5 rounded-[10px] text-[10px] font-medium transition-all",
                replyMode === "function"
                  ? "bg-bg-card text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-primary"
              )}
            >
              Function
            </button>
            <button
              type="button"
              onClick={() => switchReplyMode("manual")}
              className={clsx(
                "px-3 py-1.5 rounded-[10px] text-[10px] font-medium transition-all",
                replyMode === "manual"
                  ? "bg-bg-card text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-primary"
              )}
            >
              Manual
            </button>
          </div>

          {replyMode === "function" ? (
            <ReplyFunctionSelector
              value={config.comment_reply_fn ?? ""}
              onChange={setReplyFn}
            />
          ) : (
            <CommentRepliesField
              replies={config.comment_replies ?? []}
              onChange={setManualReplies}
            />
          )}
        </div>
      </StepCard>

      {isDm && (
        <>
          <Connector />

          {/* ── Step 3: Send DM ── */}
          <StepCard icon={<IconDM />} label="Send DM" color="amber">
            <MessageField
              label="Message"
              value={dmConfig.initial_message ?? ""}
              onChange={setInitialMessage}
              placeholder="Hey! Here's the link: https://..."
              hint="Type your URL directly in the message. Use {{username}} for the commenter's name."
            />
          </StepCard>
        </>
      )}

      {isFollowDm && <FollowDmFields config={followConfig} onChange={setFollowCfg} />}

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

function TemplatePicker({ onSelect }: { onSelect: (type: AutomationTemplateType) => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 py-12">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center mb-6">
          <h2 className="font-heading text-base font-semibold text-text-primary mb-1">
            Choose a template
          </h2>
          <p className="text-xs text-text-muted">Start with a pre-built flow.</p>
        </div>

        <div className="rounded-2xl border border-border overflow-hidden divide-y divide-border">
          {/* Comment to DM */}
          <button
            onClick={() => onSelect("comment_to_dm")}
            className="w-full text-left p-4 hover:bg-accent-cyan/[0.04] transition-all group"
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
                  Keyword in comment → public reply → send a DM.
                </p>
                <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                  {["Keyword trigger", "Comment reply", "DM"].map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded bg-bg-card border border-border text-text-muted">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </button>

          {/* Comment to Reply */}
          <button
            onClick={() => onSelect("comment_to_reply")}
            className="w-full text-left p-4 hover:bg-accent-cyan/[0.04] transition-all group"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--chart-3)]/10 border border-[var(--chart-3)]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-[var(--chart-3)]">
                  <path d="M17.5 12.5a2.5 2.5 0 0 1-2.5 2.5H5.833L2.5 17.5V5a2.5 2.5 0 0 1 2.5-2.5h10a2.5 2.5 0 0 1 2.5 2.5v7.5z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary group-hover:text-[var(--chart-3)] transition-colors">
                  Comment to Reply
                </p>
                <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
                  Keyword in comment → public reply only, no DM.
                </p>
                <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                  {["Keyword trigger", "Comment reply"].map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded bg-bg-card border border-border text-text-muted">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </button>

          {/* Comment to Follow to DM */}
          <button
            onClick={() => onSelect("comment_to_follow_dm")}
            className="w-full text-left p-4 hover:bg-accent-amber/[0.04] transition-all group"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-accent-amber/10 border border-accent-amber/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-accent-amber">
                  <circle cx="7.5" cy="7" r="3" />
                  <path d="M2.5 16.5c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5" />
                  <path d="M16 4.5v4M14 6.5h4" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary group-hover:text-accent-amber transition-colors">
                  Comment to Follow to DM
                </p>
                <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
                  Keyword → follow to unlock → DM the reward.
                </p>
                <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                  {["Keyword trigger", "Follow check", "Reward"].map((tag) => (
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
    </div>
  );
}

// ─── Flow list item ────────────────────────────────────────────────────────────

function FlowRow({
  flow,
  isSelected,
  onSelect,
  onToggle,
  onDelete,
  mediaThumbnail,
  mediaCaption,
  stats,
}: {
  flow: AutomationFlow;
  isSelected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onDelete: () => void;
  mediaThumbnail?: string | null;
  mediaCaption?: string | null;
  stats?: FlowStats;
}) {
  const mediaCount = flow.media_ids.length;
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
        {mediaCount > 0 && (
          <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-bg-base border border-border">
            {mediaThumbnail ? (
              <img src={mediaThumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[9px] text-text-muted">Post</div>
            )}
            {mediaCount > 1 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-accent-cyan text-bg-base text-[9px] font-semibold flex items-center justify-center">
                {mediaCount}
              </span>
            )}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className={clsx("text-sm font-medium truncate", isSelected ? "text-accent-cyan" : "text-text-primary")}>
            {flow.name}
          </p>
          {mediaCount > 1 ? (
            <p className="text-[10px] text-text-muted/60 truncate mt-0.5">{mediaCount} posts</p>
          ) : (
            mediaCaption && (
              <p className="text-[10px] text-text-muted/60 truncate mt-0.5">{mediaCaption}</p>
            )
          )}
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
      <div className="mt-2 flex items-center gap-2">
        {flow.is_active && (
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
            <span className="text-[10px] text-accent-green">Active</span>
          </div>
        )}
        <span className={clsx(
          "text-[9px] font-mono px-1.5 py-0.5 rounded border",
          flow.template_type === "comment_to_reply"
            ? "text-[var(--chart-3)] border-[var(--chart-3)]/30 bg-[var(--chart-3)]/5"
            : flow.template_type === "comment_to_follow_dm"
              ? "text-accent-amber border-accent-amber/30 bg-accent-amber/5"
              : "text-accent-cyan/70 border-accent-cyan/20 bg-accent-cyan/5"
        )}>
          {flow.template_type === "comment_to_reply"
            ? "→ reply"
            : flow.template_type === "comment_to_follow_dm"
              ? "→ follow → DM"
              : "→ DM"}
        </span>
        <div className="flex-1" />
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="text-[10px] text-text-muted/50 hover:text-accent-red transition-colors"
        >
          Delete
        </button>
      </div>
      {flow.template_type === "comment_to_follow_dm" && (
        <div className="mt-2 pt-2 border-t border-border/50 flex items-center gap-x-3 gap-y-1 flex-wrap text-[10px] font-mono">
          <span className="text-text-muted/80">
            <b className="text-text-primary">{stats?.invited ?? 0}</b> invited
          </span>
          <span className="text-accent-green/80">
            <b>{stats?.rewarded ?? 0}</b> rewarded
          </span>
          <span className="text-accent-amber/80">
            <b>{stats?.nudged ?? 0}</b> nudged
          </span>
          <span className="text-text-muted/60">
            <b>{stats?.expired ?? 0}</b> expired
          </span>
        </div>
      )}
      {/* comment_to_dm has no follow check and no pending row, so `sent` is the
          only counter that means anything — the other three are always 0. */}
      {flow.template_type === "comment_to_dm" && (
        <div className="mt-2 pt-2 border-t border-border/50 flex items-center gap-x-3 gap-y-1 flex-wrap text-[10px] font-mono">
          <span className="text-text-muted/80">
            <b className="text-text-primary">{stats?.invited ?? 0}</b> sent
          </span>
        </div>
      )}
    </button>
  );
}

// ─── Main client ───────────────────────────────────────────────────────────────

type EditorState =
  | { mode: "idle" }
  | { mode: "pick-template" }
  | { mode: "new"; templateType: AutomationTemplateType }
  | { mode: "edit"; flow: AutomationFlow };

export function AutomationsClient() {
  const { data: flows, isLoading } = useAutomationFlows();
  const { data: mediaData } = useMedia({ all: true });
  const { data: statsMap } = useAutomationStats();
  const mediaMap = Object.fromEntries(
    (mediaData?.data ?? []).map((m) => [m.id, m])
  );
  const create = useCreateFlow();
  const update = useUpdateFlow();
  const del = useDeleteFlow();

  const [editor, setEditor] = useState<EditorState>({ mode: "idle" });
  const selectedFlowId = editor.mode === "edit" ? editor.flow.id : null;
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const isEditing = editor.mode === "new" || editor.mode === "edit";

  function handleOuterClick(e: React.MouseEvent) {
    if (isEditing && rightPanelRef.current && !rightPanelRef.current.contains(e.target as Node)) {
      setEditor({ mode: "idle" });
    }
  }

  async function handleSave(data: {
    name: string;
    trigger_keywords: string[];
    config: AutomationConfig;
    media_ids: string[];
    template_type: AutomationTemplateType;
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
    await handleDeleteFlow(editor.flow);
  }

  async function handleDeleteFlow(flow: AutomationFlow) {
    if (!confirm(`Delete "${flow.name}"?`)) return;
    await del.mutateAsync(flow.id);
    if (editor.mode === "edit" && editor.flow.id === flow.id) {
      setEditor({ mode: "idle" });
    }
  }

  function handleToggle(flow: AutomationFlow) {
    update.mutate({ id: flow.id, is_active: !flow.is_active });
  }

  const isSaving = create.isPending || update.isPending;

  return (
    <div className="flex flex-1 overflow-hidden" onClick={handleOuterClick}>
      {/* ── Left panel ── */}
      <div className="w-72 flex-shrink-0 border-r border-border flex flex-col overflow-hidden">
        <div className="h-12 px-4 flex items-center justify-between border-b border-border flex-shrink-0">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-widest">Flows</span>
          <div className="flex items-center gap-3">
            <LogsLink />
            <button
              onClick={() => setEditor({ mode: "pick-template" })}
              className="flex items-center gap-1.5 text-xs font-medium text-accent-cyan hover:opacity-80 transition-opacity"
            >
              <IconPlus />
              New
            </button>
          </div>
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

          {flows?.map((flow) => {
            const media = flow.media_id ? mediaMap[flow.media_id] : undefined;
            return (
            <FlowRow
              key={flow.id}
              flow={flow}
              isSelected={flow.id === selectedFlowId}
              onSelect={() => setEditor({ mode: "edit", flow })}
              onToggle={() => handleToggle(flow)}
              onDelete={() => handleDeleteFlow(flow)}
              mediaThumbnail={media?.media_type === "IMAGE" ? media?.media_url : media?.thumbnail_url}
              mediaCaption={media?.caption?.slice(0, 60) ?? null}
              stats={statsMap?.[flow.id]}
            />
          );
          })}
        </div>

        <ApiUsageMeter />
      </div>

      {/* ── Right panel ── */}
      <div ref={rightPanelRef} className="flex-1 flex flex-col overflow-hidden">
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
          <TemplatePicker onSelect={(type) => setEditor({ mode: "new", templateType: type })} />
        )}

        {(editor.mode === "new" || editor.mode === "edit") && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="h-12 px-6 flex items-center gap-3 border-b border-border flex-shrink-0">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-widest">
                {editor.mode === "new"
                  ? editor.templateType === "comment_to_reply"
                    ? "New reply flow"
                    : editor.templateType === "comment_to_follow_dm"
                      ? "New follow-DM flow"
                      : "New DM flow"
                  : "Edit flow"}
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
                templateType={editor.templateType}
                onSave={handleSave}
                onCancel={() => setEditor({ mode: "idle" })}
                isSaving={isSaving}
              />
            ) : (
              <FlowEditor
                key={editor.flow.id}
                flow={editor.flow}
                templateType={editor.flow.template_type}
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
