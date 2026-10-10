// Best posting-time computation (pure, unit-tested).
// Groups posts by (weekday, hour) in the given IANA timezone and ranks
// slots by average engagement (likes + comments).

export interface MediaStat {
  timestamp: string; // ISO-8601
  like_count?: number;
  comments_count?: number;
}

export interface SlotResult {
  weekday: string; // e.g. "Mon"
  hour: number; // 0-23 in the requested timezone
  timezone: string;
  posts: number;
  avg_engagement: number;
}

const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function partsInTz(date: Date, timeZone: string): { weekday: string; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  let weekday = "";
  let hour = 0;
  for (const p of parts) {
    if (p.type === "weekday") weekday = p.value;
    if (p.type === "hour") hour = Number(p.value) % 24;
  }
  return { weekday, hour };
}

export function computeBestPostingTime(
  media: MediaStat[],
  timezone = "Asia/Kolkata",
  topN = 5,
): SlotResult[] {
  const groups = new Map<string, { weekday: string; hour: number; total: number; count: number }>();

  for (const m of media) {
    const d = new Date(m.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    let wd: string;
    let hr: number;
    try {
      ({ weekday: wd, hour: hr } = partsInTz(d, timezone));
    } catch {
      continue; // invalid timezone entry; skip post
    }
    const engagement = (m.like_count ?? 0) + (m.comments_count ?? 0);
    const key = `${wd}|${hr}`;
    const g = groups.get(key) ?? { weekday: wd, hour: hr, total: 0, count: 0 };
    g.total += engagement;
    g.count += 1;
    groups.set(key, g);
  }

  return [...groups.values()]
    .map((g) => ({
      weekday: g.weekday,
      hour: g.hour,
      timezone,
      posts: g.count,
      avg_engagement: Math.round((g.total / g.count) * 10) / 10,
    }))
    .sort(
      (a, b) =>
        b.avg_engagement - a.avg_engagement ||
        b.posts - a.posts ||
        WEEKDAY_ORDER.indexOf(a.weekday) - WEEKDAY_ORDER.indexOf(b.weekday) ||
        a.hour - b.hour,
    )
    .slice(0, Math.max(1, topN));
}
