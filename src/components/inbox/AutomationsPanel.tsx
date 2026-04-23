"use client";

import { useState, useEffect } from "react";
import { clsx } from "clsx";
import {
  useAutomations,
  useCreateAutomation,
  useUpdateAutomation,
  useDeleteAutomation,
} from "@/hooks/useAutomations";
import type { Automation } from "@/lib/db";
import { Button } from "@/components/ui/Button";

function extractPlaceholders(template: string): string[] {
  const seen: Record<string, boolean> = {};
  const result: string[] = [];
  let match: RegExpExecArray | null;
  const re = /\{\{(\w+)\}\}/g;
  while ((match = re.exec(template)) !== null) {
    if (!seen[match[1]]) {
      seen[match[1]] = true;
      result.push(match[1]);
    }
  }
  return result;
}

interface AutomationFormProps {
  postId: string;
  initial?: Automation;
  onDone: () => void;
}

function AutomationForm({ postId, initial, onDone }: AutomationFormProps) {
  const [keyword, setKeyword] = useState(initial?.keyword ?? "");
  const [actionType, setActionType] = useState<"comment" | "dm">(initial?.action_type ?? "comment");
  const [templateBody, setTemplateBody] = useState(initial?.template_body ?? "");
  const [placeholders, setPlaceholders] = useState<Record<string, string>>(initial?.placeholder_values ?? {});
  const [error, setError] = useState<string | null>(null);

  const create = useCreateAutomation();
  const update = useUpdateAutomation();
  const isPending = create.isPending || update.isPending;

  const detectedKeys = extractPlaceholders(templateBody);

  async function submit() {
    setError(null);
    if (!keyword.trim()) { setError("Keyword is required"); return; }
    if (!templateBody.trim()) { setError("Template is required"); return; }

    const filteredPlaceholders = Object.fromEntries(
      detectedKeys.map((k) => [k, placeholders[k] ?? ""])
    );

    try {
      if (initial) {
        await update.mutateAsync({
          id: initial.id,
          postId,
          keyword,
          action_type: actionType,
          template_body: templateBody,
          placeholder_values: filteredPlaceholders,
        });
      } else {
        await create.mutateAsync({
          post_id: postId,
          keyword,
          action_type: actionType,
          template_body: templateBody,
          placeholder_values: filteredPlaceholders,
          is_active: false,
        });
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-3 p-3 bg-[var(--bg-base)] rounded-2xl border border-[var(--border)]">
      <div>
        <label className="block text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
          Trigger keyword
        </label>
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="e.g. LINK"
          className="w-full text-xs bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-cyan)]"
        />
        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Case-insensitive substring match</p>
      </div>

      <div>
        <label className="block text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
          Action
        </label>
        <div className="flex gap-2">
          {(["comment", "dm"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setActionType(type)}
              className={clsx(
                "flex-1 text-xs py-1.5 rounded-xl border transition-colors",
                actionType === type
                  ? "bg-[var(--accent-cyan)]/15 border-[var(--accent-cyan)] text-[var(--accent-cyan)]"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]"
              )}
            >
              {type === "comment" ? "Reply to comment" : "Send DM"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
          Message template
        </label>
        <textarea
          value={templateBody}
          onChange={(e) => setTemplateBody(e.target.value)}
          placeholder={"Hey! Here's the link: {{link}}"}
          rows={3}
          className="w-full text-xs bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none focus:border-[var(--accent-cyan)]"
        />
        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
          Use <code className="font-mono">{"{{variable}}"}</code> for dynamic values
        </p>
      </div>

      {detectedKeys.length > 0 && (
        <div>
          <label className="block text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
            Variables
          </label>
          <div className="space-y-1.5">
            {detectedKeys.map((key) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-[var(--accent-cyan)] w-20 shrink-0 truncate">
                  {"{{"}{key}{"}}"}
                </span>
                <input
                  type="text"
                  value={placeholders[key] ?? ""}
                  onChange={(e) => setPlaceholders((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={`Value for ${key}`}
                  className="flex-1 text-xs bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-cyan)]"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-[10px] text-red-400">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={submit} loading={isPending} className="flex-1">
          {initial ? "Save changes" : "Add automation"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface AutomationRowProps {
  automation: Automation;
  postId: string;
}

function AutomationRow({ automation, postId }: AutomationRowProps) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateAutomation();
  const del = useDeleteAutomation();

  function toggleActive() {
    update.mutate({ id: automation.id, postId, is_active: !automation.is_active });
  }

  function handleDelete() {
    if (confirm(`Delete automation for keyword "${automation.keyword}"?`)) {
      del.mutate({ id: automation.id, postId });
    }
  }

  if (editing) {
    return <AutomationForm postId={postId} initial={automation} onDone={() => setEditing(false)} />;
  }

  return (
    <div className="p-2.5 rounded-2xl border border-[var(--border)] bg-[var(--bg-base)] space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-mono font-semibold text-[var(--text-primary)] bg-[var(--border)]/50 px-1.5 py-0.5 rounded">
              {automation.keyword}
            </span>
            <span className={clsx(
              "text-[10px] px-1.5 py-0.5 rounded",
              automation.action_type === "dm"
                ? "bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]"
                : "bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]"
            )}>
              {automation.action_type === "dm" ? "DM" : "Reply"}
            </span>
          </div>
          <p className="text-[10px] text-[var(--text-muted)] mt-1 leading-snug line-clamp-2">
            {automation.template_body}
          </p>
        </div>

        <button
          onClick={toggleActive}
          className={clsx(
            "shrink-0 w-8 h-4 rounded-full transition-colors relative",
            automation.is_active ? "bg-[var(--accent-cyan)]" : "bg-[var(--border)]"
          )}
          title={automation.is_active ? "Active — click to deactivate" : "Inactive — click to activate"}
        >
          <span className={clsx(
            "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
            automation.is_active ? "translate-x-[18px]" : "translate-x-0.5"
          )} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className={clsx(
          "text-[10px]",
          automation.is_active ? "text-[var(--accent-cyan)]" : "text-[var(--text-muted)]"
        )}>
          {automation.is_active ? "Active" : "Inactive"}
        </span>
        <div className="flex-1" />
        <button onClick={() => setEditing(true)} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          Edit
        </button>
        <button onClick={handleDelete} className="text-[10px] text-[var(--text-muted)] hover:text-red-400 transition-colors">
          Delete
        </button>
      </div>
    </div>
  );
}

interface AutomationsPanelProps {
  postId: string;
  onActivityChange?: (postId: string, hasActive: boolean) => void;
}

export function AutomationsPanel({ postId, onActivityChange }: AutomationsPanelProps) {
  const [adding, setAdding] = useState(false);
  const { data: automations, isLoading } = useAutomations(postId);

  const hasActive = automations?.some((a) => a.is_active) ?? false;
  useEffect(() => {
    if (onActivityChange) onActivityChange(postId, hasActive);
  }, [postId, hasActive, onActivityChange]);

  return (
    <div className="h-full flex flex-col">
      <div className="h-12 px-4 border-b border-[var(--border)] flex items-center justify-between shrink-0">
        <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">
          Automations
        </h3>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="text-[10px] text-[var(--accent-cyan)] hover:underline"
          >
            + Add
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {adding && (
          <AutomationForm postId={postId} onDone={() => setAdding(false)} />
        )}

        {isLoading && (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 rounded bg-[var(--border)] animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && automations?.length === 0 && !adding && (
          <p className="text-[10px] text-[var(--text-muted)] text-center mt-6 leading-relaxed">
            No automations yet.<br />Add one to auto-reply when a keyword is detected.
          </p>
        )}

        {automations?.map((automation) => (
          <AutomationRow key={automation.id} automation={automation} postId={postId} />
        ))}
      </div>
    </div>
  );
}
