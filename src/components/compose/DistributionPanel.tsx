"use client";

import type { ComposeDraft } from "@/lib/compose/draft";
import { Switch } from "./Switch";

type Update = (patch: Partial<ComposeDraft>) => void;

export function DistributionPanel({ draft, update }: { draft: ComposeDraft; update: Update }) {
  const isReel = draft.tab === "REEL";

  return (
    <section className="cs-sec">
      <div className="cs-sh">
        <span className="n">04</span>
        <h2>Distribution</h2>
      </div>

      {isReel && (
        <div className="cs-trow">
          <div className="l">
            <b>Share to feed</b>
            <span>share_to_feed · appear in Feed + Reels tab</span>
          </div>
          <div className="r">
            <Switch on={draft.shareToFeed} onChange={(v) => update({ shareToFeed: v })} label="Share to feed" />
          </div>
        </div>
      )}

      <div className="cs-trow">
        <div className="l">
          <b>Paid partnership</b>
          <span>is_paid_partnership · adds label</span>
        </div>
        <div className="r">
          <Switch on={draft.isPaidPartnership} onChange={(v) => update({ isPaidPartnership: v })} label="Paid partnership" />
        </div>
      </div>

      <div className="cs-trow">
        <div className="l">
          <b>AI generated</b>
          <span>is_ai_generated · self-disclosure</span>
        </div>
        <div className="r">
          <Switch on={draft.isAiGenerated} onChange={(v) => update({ isAiGenerated: v })} label="AI generated" />
        </div>
      </div>
    </section>
  );
}
