/**
 * The fabricated account used for the portfolio screenshots.
 *
 * This module is shared by the Graph mock and the database seeder. Everything is
 * invented: the account, people, campaign, copy, media, performance, and flows.
 * Keeping it in one place makes the demo believable without ever involving an
 * account that exists outside this repository.
 */

/** The capture clock stays current while making a same-day run stable. */
export const NOW = (() => {
  const date = new Date();
  date.setHours(9, 0, 0, 0);
  return date;
})();

export const ACCOUNT_ID = "17841400000000001";
export const PROFILE = {
  id: ACCOUNT_ID,
  username: "lumenfield_demo",
  name: "Lumen Field / Demo",
  biography: "A fictional creative studio sharing the work between the work.",
  followers_count: 28760,
  media_count: 42,
  account_type: "MEDIA_CREATOR",
  website: "https://lumenfield.example",
};

const DAY = 86_400_000;

function rng(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * The campaign is deliberately broad enough to make an actual account: faces,
 * process, places, objects, and only a few typographic editorial moments. Each
 * `cover` has a corresponding local file under assets/campaign.
 */
const STORIES = [
  ["First light in the fitting room", "portrait-sun", "people"],
  ["A blue hour test before doors open", "city-blue", "place"],
  ["The sample table, before the clean-up", "material-table", "process"],
  ["Folding the first run by hand", "product-fold", "object"],
  ["Five minutes with the light meter", "studio-light", "process"],
  ["The long walk to the location", "city-walk", "place"],
  ["A note on making the box feel kept", "editorial-kept", "editorial"],
  ["Portrait study: red chair, late afternoon", "portrait-red", "people"],
  ["Tape, tracing paper, one useful mistake", "process-paper", "process"],
  ["The object, once the room goes quiet", "product-shadow", "object"],
  ["An ordinary coffee between set changes", "city-coffee", "place"],
  ["What made the final colour stay", "editorial-colour", "editorial"],
  ["Crew call, ten minutes before rain", "people-rain", "people"],
  ["Detail study: edge, seam, reflection", "product-detail", "object"],
  ["The test prints we did not throw away", "process-print", "process"],
  ["After the gallery closed", "city-night", "place"],
  ["Small notes from launch week", "editorial-notes", "editorial"],
  ["A borrowed chair in the studio window", "portrait-window", "people"],
];

const TAGS = "#creativepractice #studiolife #launchweek";

/**
 * Four recurring weekly posting hours create enough sample depth for the current
 * hour-by-hour Best Time instrument. A few 7am tests remain deliberately sparse,
 * so its dashed low-confidence treatment has something honest to explain.
 */
function recentSlots() {
  const dates = [];
  for (let daysAgo = 1; dates.length < 42 && daysAgo < 110; daysAgo++) {
    const date = new Date(NOW.getTime() - daysAgo * DAY);
    const weekday = date.getDay();
    const week = Math.floor(daysAgo / 7);
    // The same cadence, gently varied week-to-week: enough confidence at a
    // handful of useful windows without generating a suspiciously full 24-hour chart.
    const hour =
      weekday === 0 ? (week % 2 ? 19 : 18) :
      weekday === 2 ? (week % 3 ? 9 : 8) :
      weekday === 4 ? (week % 2 ? 13 : 12) :
      weekday === 6 ? (week % 3 === 1 ? 21 : 18) : null;
    if (hour != null) {
      date.setHours(hour, 12 + ((daysAgo * 13) % 42), 0, 0);
      dates.push(date);
    }
    // Two early experiments stay visibly under-sampled and earn the chart's
    // dashed treatment rather than presenting a one-off result as a pattern.
    if (weekday === 3 && daysAgo % 42 === 4 && dates.length < 42) {
      date.setHours(7, 24, 0, 0);
      dates.push(date);
    }
  }
  return dates.sort((a, b) => b.getTime() - a.getTime()).slice(0, 42);
}

function performanceFor(index, rand) {
  const band = index === 5 || index === 24 ? "breakout" : index % 7 === 0 ? "strong" : index % 9 === 0 ? "quiet" : "steady";
  const bounds = {
    breakout: [42_000, 55_000],
    strong: [24_000, 32_000],
    steady: [12_500, 20_500],
    quiet: [7_500, 10_800],
  }[band];
  const views = Math.round(bounds[0] + rand() * (bounds[1] - bounds[0]));
  const reach = Math.round(views * (0.69 + rand() * 0.11));
  const likes = Math.round(views * (0.043 + rand() * 0.015));
  const comments = Math.round(likes * (0.065 + rand() * 0.055));
  const shares = Math.round(likes * (0.09 + rand() * 0.055));
  const saved = Math.round(likes * (0.17 + rand() * 0.11));
  const avgWatchSeconds = 8.5 + rand() * 5.5;

  return {
    band,
    views,
    reach,
    likes,
    comments,
    shares,
    saved,
    total_interactions: likes + comments + shares + saved,
    ig_reels_avg_watch_time: Math.round(avgWatchSeconds * 1000),
    ig_reels_video_view_total_time: Math.round(views * avgWatchSeconds * 1000),
  };
}

/** 42 published Reels, newest first, from roughly the previous eleven weeks. */
export const MEDIA = (() => {
  const rand = rng(73);
  return recentSlots().map((posted, index) => {
    const [title, cover, subject] = STORIES[index % STORIES.length];
    const insights = performanceFor(index, rand);
    return {
      id: `1793${String(4000000000000 + index * 1370411).padStart(13, "0")}`,
      caption: `${title}.\n\n${TAGS}`,
      media_type: "VIDEO",
      media_product_type: "REELS",
      permalink: `https://www.instagram.com/reel/LUMENDEMO${index}/`,
      shortcode: `LUMENDEMO${index}`,
      timestamp: posted.toISOString(),
      like_count: insights.likes,
      comments_count: insights.comments,
      title,
      cover,
      subject,
      insights,
    };
  });
})();

/**
 * Daily account-insight values. follower_count is a daily acquisition delta—the
 * dashboard reconstructs the cumulative total from it using PROFILE's total.
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

  for (let daysAgo = 59; daysAgo >= 0; daysAgo--) {
    const endTime = new Date(NOW.getTime() - daysAgo * DAY);
    endTime.setUTCHours(7, 0, 0, 0);
    const progress = (59 - daysAgo) / 59;
    const launchBump = 82 * Math.exp(-(((daysAgo - 21) / 5.5) ** 2));
    const jitter = 0.9 + rand() * 0.18;
    const follows = Math.round((42 + progress * 20 + launchBump) * jitter);
    const reach = Math.round((6_400 + progress * 2_100 + launchBump * 42) * jitter);
    const engaged = Math.round((1_150 + progress * 440 + launchBump * 7) * jitter);

    metrics.follower_count.push({ value: follows, end_time: endTime.toISOString() });
    metrics.reach.push({ value: reach, end_time: endTime.toISOString() });
    metrics.profile_views.push({ value: Math.round((310 + progress * 130 + launchBump * 1.9) * jitter), end_time: endTime.toISOString() });
    metrics.accounts_engaged.push({ value: engaged, end_time: endTime.toISOString() });
    metrics.total_interactions.push({ value: Math.round(engaged * (1.12 + rand() * 0.16)), end_time: endTime.toISOString() });
  }

  return metrics;
})();

const QUEUE_STORIES = STORIES.slice(0, 17);

/**
 * One published history week plus two fully future planning weeks. The first
 * future Monday is always at least seven days away, so a capture can never make
 * an open job due simply by running later in the day.
 */
export const SCHEDULED = (() => {
  const rand = rng(31);
  const monday = new Date(NOW);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + 7);
  monday.setHours(0, 0, 0, 0);
  const slots = [
    [1, 9, 10], [2, 12, 30], [3, 7, 45], [4, 18, 10], [5, 12, 15], [6, 18, 30], [0, 9, 0],
  ];
  const jobs = [];
  let index = 0;

  for (const week of [-1, 0, 1]) {
    for (const [dow, hour, minute] of slots) {
      const at = new Date(monday);
      at.setDate(at.getDate() + week * 7 + ((dow + 6) % 7));
      at.setHours(hour, minute, 0, 0);
      const [title] = QUEUE_STORIES[index % QUEUE_STORIES.length];
      const platform = index % 4 === 3 ? "yt" : "ig";
      jobs.push({
        id: `job_${String(index).padStart(3, "0")}`,
        platform,
        status: week < 0 ? "published" : index === 11 ? "paused" : "pending",
        scheduled_at: at.getTime(),
        title,
        caption: `${title}.\n\n${TAGS}`,
        automation: index % 3 === 0,
        file: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.mp4`,
        size_bytes: Math.round(9_000_000 + rand() * 21_000_000),
      });
      index++;
    }
  }
  return jobs;
})();

/** Comment-to-DM flows tie useful fictional resources to relevant campaign posts. */
export const FLOWS = [
  { name: "Lighting checklist", keyword: "LIGHT", sent: 824, active: 1, media: 4 },
  { name: "Launch call sheet", keyword: "CALLSHEET", sent: 641, active: 1, media: 12 },
  { name: "Colour test notes", keyword: "COLOUR", sent: 512, active: 1, media: 11 },
  { name: "Materials guide", keyword: "MATERIALS", sent: 438, active: 1, media: 2 },
  { name: "Packing template", keyword: "PACK", sent: 307, active: 1, media: 3 },
  { name: "Location list", keyword: "LOCATIONS", sent: 196, active: 0, media: 5 },
  { name: "Studio edit guide", keyword: "EDIT", sent: 284, active: 1, media: 14 },
];
