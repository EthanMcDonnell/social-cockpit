"use client";

import type { ComposeDraft } from "@/lib/compose/draft";

type Update = (patch: Partial<ComposeDraft>) => void;

export function TaggingPanel({ draft, update }: { draft: ComposeDraft; update: Update }) {
  return (
    <section className="cs-sec">
      <div className="cs-sh">
        <span className="n">05</span>
        <h2>Tagging</h2>
        <span className="hint">collaborators · user_tags · product_tags</span>
      </div>

      <div className="cs-three">
        <div className="cs-field">
          <div className="cs-flabel"><span>Collaborators</span><b>≤3</b></div>
          <input
            className="cs-input"
            type="text"
            placeholder="@a, @b"
            value={draft.collaborators}
            onChange={(e) => update({ collaborators: e.target.value })}
          />
        </div>
        <div className="cs-field">
          <div className="cs-flabel"><span>Tag people</span></div>
          <input
            className="cs-input"
            type="text"
            placeholder="@user, @user"
            value={draft.userTags}
            onChange={(e) => update({ userTags: e.target.value })}
          />
        </div>
        <div className="cs-field">
          <div className="cs-flabel"><span>Products</span><b>≤5</b></div>
          <input
            className="cs-input"
            type="text"
            placeholder="product ids"
            value={draft.productTags}
            onChange={(e) => update({ productTags: e.target.value })}
          />
        </div>
      </div>
    </section>
  );
}
