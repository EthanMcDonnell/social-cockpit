"use client";

import type { ComposeDraft, GraduationStrategy } from "@/lib/compose/draft";
import { Switch } from "./Switch";

type Update = (patch: Partial<ComposeDraft>) => void;

const STRATEGIES: { value: GraduationStrategy; title: string; blurb: string }[] = [
  { value: "MANUAL", title: "Manual", blurb: "You graduate it to followers in-app when you decide." },
  { value: "SS_PERFORMANCE", title: "Auto · Performance", blurb: "Graduates automatically if it performs well." },
];

export function TrialPanel({ draft, update }: { draft: ComposeDraft; update: Update }) {
  return (
    <section className="cs-sec">
      <div className="cs-sh">
        <span className="n">03</span>
        <h2>Trial Reel</h2>
        <span className="hint">trial_params.graduation_strategy</span>
      </div>

      <div className="cs-trow cs-trow-lead">
        <div className="l">
          <b>Publish as trial</b>
          <span>Show to non-followers first, then graduate</span>
        </div>
        <div className="r">
          <Switch on={draft.isTrial} onChange={(v) => update({ isTrial: v })} label="Publish as trial reel" />
        </div>
      </div>

      {draft.isTrial && (
        <div className="cs-grad">
          {STRATEGIES.map((s) => (
            <button
              key={s.value}
              type="button"
              className={draft.graduationStrategy === s.value ? "on" : undefined}
              onClick={() => update({ graduationStrategy: s.value })}
            >
              <b>{s.title}</b>
              {s.blurb}
              <span className="cs-chip">{s.value}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
