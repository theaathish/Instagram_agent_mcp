// Best-posting-time computation tests (pure function, fixed timestamps).

import { describe, expect, it } from "vitest";
import { computeBestPostingTime } from "../lib/besttime";

describe("computeBestPostingTime", () => {
  it("groups by weekday/hour in Asia/Kolkata and ranks by avg engagement", () => {
    // 2026-10-05 is a Monday. 12:00 UTC == 17:30 IST.
    const media = [
      { timestamp: "2026-10-05T12:00:00Z", like_count: 100, comments_count: 10 },
      { timestamp: "2026-10-05T12:20:00Z", like_count: 50, comments_count: 5 },
      { timestamp: "2026-10-06T03:00:00Z", like_count: 10, comments_count: 1 }, // Tue 08:30 IST
    ];
    const slots = computeBestPostingTime(media, "Asia/Kolkata", 5);
    expect(slots.length).toBe(2);
    expect(slots[0]).toMatchObject({ weekday: "Mon", hour: 17, posts: 2, avg_engagement: 82.5 });
    expect(slots[1]).toMatchObject({ weekday: "Tue", hour: 8, posts: 1 });
  });

  it("returns top_n slots at most and handles empty input", () => {
    const media = Array.from({ length: 8 }, (_, i) => ({
      timestamp: `2026-10-0${1 + (i % 7)}T${String(i).padStart(2, "0")}:00:00Z`,
      like_count: i,
      comments_count: 0,
    }));
    expect(computeBestPostingTime(media, "Asia/Kolkata", 3).length).toBe(3);
    expect(computeBestPostingTime([], "Asia/Kolkata")).toEqual([]);
  });

  it("skips invalid timestamps and treats missing counts as zero", () => {
    const slots = computeBestPostingTime(
      [{ timestamp: "not-a-date" }, { timestamp: "2026-10-05T12:00:00Z" }],
      "UTC",
      5,
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].avg_engagement).toBe(0);
  });

  it("respects a different timezone (UTC vs IST differ)", () => {
    const media = [{ timestamp: "2026-10-05T01:00:00Z", like_count: 5, comments_count: 0 }];
    const ist = computeBestPostingTime(media, "Asia/Kolkata", 5);
    const utc = computeBestPostingTime(media, "UTC", 5);
    expect(ist[0].hour).toBe(6); // 01:00Z == 06:30 IST
    expect(utc[0].hour).toBe(1);
  });
});
