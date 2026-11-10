import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBrief, dedupeKey, needsAttention, pickRecipients, shouldSendBrief } from "../lib/brief.js";
import { shapeFollowups, type FollowRow } from "../lib/followups.js";
import { shapeToday, type AssignmentRow } from "../lib/today.js";

const TODAY = "2026-11-10"; // 週二
const frow = (over: Partial<FollowRow> & { id: string }): FollowRow => ({
  title: "回覆內湖店", status: "to_reply", priority: "normal", contact: null, note: null, due_date: null, waiting_since: null,
  created_at: "2026-11-09T00:00:00Z", completed_at: null, site_id: null, sites: null, ...over,
});
const arow = (over: Partial<AssignmentRow> = {}): AssignmentRow => ({
  task_id: "t", work_date: TODAY, start_time: "09:00:00", end_time: "12:00:00", kind: "S", pay_mode: "regular",
  people: { name: "飛哥" }, vehicles: { name: "ZINGER" }, tasks: { title: "晶心 裝監視器", sites: null }, ...over,
});
const base = (follow: FollowRow[] = [], assignments: AssignmentRow[] = [arow()], leaves: string[] = [], pool = 0, liffId: string | null = "L1") =>
  buildBrief({ today: TODAY, todayView: shapeToday(TODAY, assignments, leaves), follow: shapeFollowups(follow, TODAY), poolCount: pool, liffId: liffId ?? undefined });

describe("morning brief content", () => {
  it("greets with the date and lists today's jobs with people, vehicle and 點", () => {
    const b = base([], [arow(), arow({ people: { name: "阿倫" } })]);
    expect(b.text).toContain("早安！今天 11/10（二）");
    expect(b.text).toContain("【今天的工作（1）】\n・09:00–12:00 晶心 裝監視器（飛哥、阿倫｜ZINGER）");
    expect(base([], [arow({ work_date: "2026-11-14", pay_mode: "daily" })]).text).toContain("｜點）");
  });
  it("says so when nothing is scheduled, and lists who is on leave", () => {
    const b = base([], [], ["楊東翰", "阿東"]);
    expect(b.text).toContain("今天還沒有排定的工作");
    expect(b.text).toContain("【請假】\n楊東翰、阿東");
  });
  it("highlights urgent, overdue and long-waiting follow-ups and only counts the rest", () => {
    const b = base([
      frow({ id: "1", title: "要不要吃晚餐", priority: "high", contact: "朋友" }),
      frow({ id: "2", title: "逾期的事", due_date: "2026-11-08" }),
      frow({ id: "3", title: "一般的事" }),
      frow({ id: "4", title: "廠商報價", status: "waiting_other", waiting_since: "2026-11-05T00:00:00Z" }),
      frow({ id: "5", title: "剛問的", status: "waiting_other", waiting_since: "2026-11-10T00:00:00Z" }),
    ]);
    expect(b.text).toContain("・要不要吃晚餐（急，對方：朋友）");
    expect(b.text).toContain("・逾期的事（已逾期 2 天）");
    expect(b.text).not.toContain("一般的事");
    expect(b.text).toContain("另有 1 件一般待回覆");
    expect(b.text).toContain("【等對方太久了】\n・廠商報價（已等 5 天）");
    expect(b.text).not.toContain("剛問的");
  });
  it("mentions the flexible holds and the unassigned pool", () => {
    const b = base([frow({ id: "h", title: "元式鐵捲門維修", status: "flexible_hold", due_date: "2026-11-10" })], [], [], 3);
    expect(b.text).toContain("【機動保留（1）】\n・元式鐵捲門維修（期限 11/10）");
    expect(b.text).toContain("【待排工作】\n3 件還沒決定派誰");
  });
  it("caps long lists", () => {
    const many = Array.from({ length: 8 }, (_, i) => arow({ task_id: `t${i}`, tasks: { title: `工作${i}`, sites: null } }));
    expect(base([], many).text).toContain("…還有 3 件");
  });
  it("needsAttention matches urgent, overdue, or waiting 3+ days", () => {
    const [u] = shapeFollowups([frow({ id: "u", priority: "high" })], TODAY).to_reply;
    const [n] = shapeFollowups([frow({ id: "n" })], TODAY).to_reply;
    expect(needsAttention(u)).toBe(true);
    expect(needsAttention(n)).toBe(false);
  });
});

describe("morning brief message", () => {
  it("is a Flex card with buttons to today's page and the follow-up page when the LIFF id is known", () => {
    const f = JSON.stringify(base().flex);
    expect(f).toContain("https://liff.line.me/L1/today");
    expect(f).toContain("https://liff.line.me/L1/follow");
    expect(f).toContain("看今日排程");
    expect(JSON.parse(f).altText).toContain("早安");
  });
  it("omits the buttons rather than sending a broken link when the LIFF id is missing", () => {
    const f = JSON.stringify(base([], [arow()], [], 0, null).flex);
    expect(f).not.toContain("liff.line.me");
    expect(f).not.toContain("footer");
  });
});

describe("when to stay quiet", () => {
  const view = (assignments: AssignmentRow[], date = "2026-11-14") => shapeToday(date, assignments, []);
  it("always sends on a workday", () => {
    expect(shouldSendBrief(TODAY, shapeToday(TODAY, [], []), shapeFollowups([], TODAY))).toBe(true);
  });
  it("stays quiet on a weekend or national holiday with nothing scheduled and nothing urgent", () => {
    expect(shouldSendBrief("2026-11-14", view([]), shapeFollowups([], "2026-11-14"))).toBe(false);
    expect(shouldSendBrief("2026-02-17", view([], "2026-02-17"), shapeFollowups([frow({ id: "x" })], "2026-02-17"))).toBe(false);
  });
  it("still sends on a holiday if someone is scheduled or something is urgent", () => {
    expect(shouldSendBrief("2026-11-14", view([arow({ work_date: "2026-11-14" })]), shapeFollowups([], "2026-11-14"))).toBe(true);
    expect(shouldSendBrief("2026-11-14", view([]), shapeFollowups([frow({ id: "u", priority: "high" })], "2026-11-14"))).toBe(true);
  });
});

describe("recipients and de-duplication", () => {
  it("sends only to BRIEF_USER_IDS when set, otherwise only to the owner, and to nobody if neither exists", () => {
    expect(pickRecipients("", ["Uboss"])).toEqual(["Uboss"]);
    expect(pickRecipients(" Ub , Ub,Uc ", ["Uboss"])).toEqual(["Ub", "Uc"]);
    expect(pickRecipients("", [])).toEqual([]);
    expect(pickRecipients("", ["", "Uboss"])).toEqual(["Uboss"]);
  });
  it("builds one key per person per day per kind, and a distinct key only for deliberate resends", () => {
    expect(dedupeKey("2026-11-10", "Ua")).toBe("morning:2026-11-10:Ua");
    expect(dedupeKey("2026-11-10", "Ua", undefined, "arrive")).toBe("arrive:2026-11-10:Ua");
    expect(dedupeKey("2026-11-10", "Ua", undefined, "arrive")).not.toBe(dedupeKey("2026-11-10", "Ua", undefined, "done"));
    expect(dedupeKey("2026-11-10", "Ua", 123)).not.toBe(dedupeKey("2026-11-10", "Ua"));
    expect(dedupeKey("2026-11-11", "Ua")).not.toBe(dedupeKey("2026-11-10", "Ua"));
  });
});

describe("scheduling", () => {
  const v = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const taipei = (schedule: string) => {
    const [min, hour] = schedule.split(" ").map(Number);
    return `${String((hour + 8) % 24).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  };
  it("runs the morning brief at 07:00 Taipei (= 23:00 UTC the day before) on Vercel's built-in cron", () => {
    const c = v.crons.find((x: { path: string }) => x.path === "/api/cron/remind?kind=morning");
    expect(c.schedule).toBe("0 23 * * *");
    expect(taipei(c.schedule)).toBe("07:00");
  });
  it("keeps every cron at most once a day (the Hobby plan limit), with the leave sync before the brief", () => {
    for (const c of v.crons) expect(c.schedule, c.path).toMatch(/^\d+ \d+ \* \* \*$/);
    const sync = v.crons.find((x: { path: string }) => x.path === "/api/cron/sync-leaves");
    expect(taipei(sync.schedule) < "07:00").toBe(true);
  });
  it("documents the Supabase schedule for 10:00, 16:00 and 20:00 with the right UTC times", () => {
    const doc = readFileSync(new URL("../docs/scheduling.md", import.meta.url), "utf8");
    for (const w of ["pg_cron", "kind=arrive", "kind=done", "kind=evening", "'0 2 * * *'", "'0 8 * * *'", "'0 12 * * *'", "net.http_get", "vault"]) expect(doc).toContain(w);
    expect(taipei("0 2 * * *")).toBe("10:00");
    expect(taipei("0 8 * * *")).toBe("16:00");
    expect(taipei("0 12 * * *")).toBe("20:00");
  });
});

describe("the cron endpoint", () => {
  it("refuses callers without the secret and rejects unknown kinds", async () => {
    const { GET } = await import("../api/cron/remind.js");
    expect((await GET(new Request("http://x/api/cron/remind?kind=morning"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/cron/remind", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    process.env.CRON_SECRET = "s3cret";
    try {
      const bad = await GET(new Request("http://x/api/cron/remind?kind=lunch", { headers: { authorization: "Bearer s3cret" } }));
      expect(bad.status).toBe(400);
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});
