/**
 * The fabricated account the portfolio screenshots are taken of.
 *
 * Every number, caption and username here is invented. That is the point: the
 * earlier screenshots were the real account with black boxes painted over every
 * private region, which reads as a broken app rather than a working one. A
 * coherent fictional account shows the same software with nothing to hide.
 *
 * Shared by mock-graph.mjs (serves it as the Graph API) and seed.mjs (writes it
 * into the demo databases), so the two can never drift.
 */

/**
 * The clock everything is generated around: 09:00 this morning.
 *
 * Anchored to the run date rather than a hard-coded one, because the app is
 * not. The dashboard trims its window to the last 48 hours of real time and the
 * calendar opens on the real current week, so a frozen dataset would screenshot
 * as a half-empty chart and a calendar of last month. Within a day it is stable,
 * which is as reproducible as this can honestly be.
 */
export const NOW = (() => {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return d;
})();

export const ACCOUNT_ID = "17841400000000001";

export const PROFILE = {
  id: ACCOUNT_ID,
  username: "howitsbuilt",
  name: "How It's Built",
  biography: "Short explainers on the engineering behind software you use daily.",
  followers_count: 18432,
  media_count: 147,
  account_type: "MEDIA_CREATOR",
  website: "https://howitsbuilt.example",
};

/** Headlines for the published back catalogue and the scheduled queue. */
const TITLES = [
  "How Figma renders 60fps in a browser tab",
  "Why Discord rewrote its read states in Rust",
  "The queue that keeps Airbnb bookings honest",
  "How Cloudflare serves a fifth of the web",
  "Why Shopify still runs one giant monolith",
  "What actually happens when you type git push",
  "How Stripe made retries safe to send twice",
  "The trick behind Google Docs going offline",
  "Why Netflix built its own CDN boxes",
  "How WhatsApp served 2 billion users on Erlang",
  "How Spotify assembles Discover Weekly",
  "Why Instagram stores photos in Cassandra",
  "How Uber schedules 20 million trips a day",
  "The one index that fixed our p99",
  "Why your Docker build is slow",
  "How Vercel makes cold starts disappear",
  "What a CDN actually caches",
  "Why Postgres VACUUM exists at all",
  "How Slack keeps 500k websockets alive",
  "The maths behind rate limiting",
  "Why Kafka writes to disk on purpose",
  "How DNS finds anything in 30ms",
  "Why React had to rewrite its renderer",
  "How S3 hits eleven nines",
  "The compiler pass nobody talks about",
  "Why load balancers pick at random",
];

const HASHTAGS = "#softwareengineering #systemdesign #devtools #backend";

/** A deterministic pseudo-random stream, so re-runs are identical. */
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const day = 86_400_000;

/**
 * 42 published Reels, newest first.
 *
 * Dated from a weekly posting rhythm rather than a fixed stride: the dashboard
 * has a posts-per-day chart, and an evenly spaced catalogue draws it as a row of
 * identical bars, which is the shape of generated data rather than of a person
 * posting.
 */
export const MEDIA = (() => {
  const rand = rng(7);
  // Posts per weekday, Sunday first. Wednesday is the double.
  const PER_WEEKDAY = [0, 1, 1, 2, 1, 1, 1];

  const dates = [];
  for (let d = 1; dates.length < 42 && d < 120; d++) {
    const day = new Date(NOW.getTime() - d * 86_400_000);
    let n = PER_WEEKDAY[day.getDay()];
    if (n && rand() < 0.22) n -= 1;        // the odd skipped slot
    for (let k = 0; k < n && dates.length < 42; k++) {
      // Spread across the slots a creator actually uses. A single narrow window
      // draws the best-time-to-post heatmap as two lonely bars.
      const SLOTS = [7, 8, 9, 12, 13, 17, 18, 19];
      const at = new Date(day);
      const hour = SLOTS[Math.floor(rand() * SLOTS.length / 2) + (k ? 4 : 0)];
      at.setHours(hour, Math.floor(rand() * 60), 0, 0);
      dates.push(at);
    }
  }

  return dates.map((posted, i) => {
    // Two breakouts, the rest in a believable band. Kept within one order of
    // magnitude of the median so the views chart has shape rather than spikes.
    const breakout = i === 4 || i === 17;
    const views = Math.round(breakout ? 48_000 + rand() * 26_000 : 5_500 + rand() * 15_000);
    const reach = Math.round(views * (0.72 + rand() * 0.13));
    const likes = Math.round(views * (0.031 + rand() * 0.018));
    const comments = Math.round(likes * (0.05 + rand() * 0.05));
    return {
      id: `1793${String(4000000000000 + i * 1370411).padStart(13, "0")}`,
      caption: `${TITLES[i % TITLES.length]}\n\n${HASHTAGS}`,
      media_type: "VIDEO",
      media_product_type: "REELS",
      permalink: `https://www.instagram.com/reel/DEMO${i}/`,
      shortcode: `DEMO${i}`,
      timestamp: posted.toISOString(),
      like_count: likes,
      comments_count: comments,
      title: TITLES[i % TITLES.length],
      insights: {
        reach,
        views,
        likes,
        comments,
        shares: Math.round(likes * (0.08 + rand() * 0.07)),
        saved: Math.round(likes * (0.14 + rand() * 0.1)),
        total_interactions: likes + comments,
        ig_reels_avg_watch_time: Math.round(7_000 + rand() * 9_000),
        ig_reels_video_view_total_time: Math.round(views * (9 + rand() * 6) * 1000),
      },
    };
  });
})();

/**
 * Daily deltas for the last 60 days.
 *
 * Two things constrain the shape. The chart walks these back from the profile's
 * current total to draw a cumulative line, so the *sum* sets where the line
 * starts. And the readout compares the first day's delta with the last day's,
 * so growth has to be trending up for the panel to read as an account that is
 * working - a flat random series lands on a coin-flip arrow.
 */
export const USER_INSIGHTS = (() => {
  const rand = rng(19);
  const metrics = {
    follower_count: [],
    reach: [],
    profile_views: [],
    accounts_engaged: [],
    total_interactions: [],
  };
  for (let i = 59; i >= 0; i--) {
    const endTime = new Date(NOW.getTime() - i * day);
    endTime.setUTCHours(7, 0, 0, 0);
    const iso = endTime.toISOString();
    const progress = (59 - i) / 59;
    // A gaussian around the breakout Reel, so the cumulative line bends rather
    // than steps.
    const bump = 150 * Math.exp(-(((i - 16) / 5) ** 2));
    const base = 42 + progress * 26 + bump;
    const jitter = 0.86 + rand() * 0.28;
    metrics.follower_count.push({ value: Math.round(base * jitter), end_time: iso });
    metrics.reach.push({ value: Math.round((4_800 + progress * 2_400 + bump * 22) * jitter), end_time: iso });
    metrics.profile_views.push({ value: Math.round((240 + progress * 160 + bump * 1.6) * jitter), end_time: iso });
    metrics.accounts_engaged.push({ value: Math.round((700 + progress * 420 + bump * 5) * jitter), end_time: iso });
    metrics.total_interactions.push({ value: Math.round((1_100 + progress * 640 + bump * 8) * jitter), end_time: iso });
  }
  return metrics;
})();

/**
 * The scheduled queue: a fortnight of work in flight. Deliberately dense - the
 * screenshot exists to show a calendar being used, and three cards in an empty
 * grid does not.
 */
export const SCHEDULED = (() => {
  const rand = rng(31);
  // Weekday slots the account actually posts in, in local time.
  const slots = [
    [1, 7, 30], [1, 12, 15], [1, 18, 45],
    [2, 8, 0], [2, 17, 30],
    [3, 7, 45], [3, 12, 30], [3, 19, 0],
    [4, 8, 15], [4, 18, 0],
    [5, 7, 30], [5, 13, 0], [5, 17, 45],
    [6, 10, 0], [6, 16, 30],
    [0, 11, 0], [0, 19, 15],
  ];
  // Monday of the screenshot week.
  const monday = new Date(NOW);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  const jobs = [];
  let n = 0;
  for (const week of [0, 1]) {
    for (const [dow, hh, mm] of slots) {
      const at = new Date(monday);
      at.setDate(at.getDate() + week * 7 + ((dow + 6) % 7));
      at.setHours(hh, mm, 0, 0);
      const past = at.getTime() < NOW.getTime();
      const title = TITLES[n % TITLES.length];
      const platform = n % 4 === 3 ? "yt" : "ig";
      jobs.push({
        id: `job_${String(n).padStart(3, "0")}`,
        platform,
        // Everything behind the fixed clock has already gone out; one paused job
        // ahead of it, because a calendar with a single status is a mockup.
        status: past ? "published" : n === 9 ? "paused" : "pending",
        scheduled_at: at.getTime(),
        title,
        caption: `${title}\n\n${HASHTAGS}`,
        automation: n % 3 === 0,
        file: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.mp4`,
        size_bytes: Math.round(8_000_000 + rand() * 24_000_000),
      });
      n++;
    }
  }
  return jobs;
})();

/** Comment→DM flows, each pointing at one of the published Reels. */
export const FLOWS = [
  { name: "Systems cheatsheet", keyword: "SYSTEMS", sent: 1284, active: 1, media: 0 },
  { name: "Postgres index guide", keyword: "INDEX", sent: 872, active: 1, media: 3 },
  { name: "Rust migration notes", keyword: "RUST", sent: 611, active: 1, media: 1 },
  { name: "CDN explainer", keyword: "CDN", sent: 430, active: 1, media: 4 },
  { name: "Docker checklist", keyword: "DOCKER", sent: 268, active: 1, media: 6 },
  { name: "Rate limit worksheet", keyword: "LIMITS", sent: 154, active: 0, media: 9 },
  { name: "Kafka starter repo", keyword: "KAFKA", sent: 97, active: 1, media: 11 },
];
