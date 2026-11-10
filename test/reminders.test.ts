import { describe, expect, it } from "vitest";
import { shapeFollowups, type FollowRow } from "../lib/followups.js";
import { addDays, buildArrive, buildDone, buildEvening } from "../lib/reminders.js";
import { shapeToday, type AssignmentRow } from "../lib/today.js";

const TODAY = "2026-11-10"; // 週二
const arow = (over: Partial<AssignmentRow> = {}): AssignmentRow => ({
  task_id: "t", work_date: TODAY, start_time: "09:00:00", end_time: "12:00:00", kind: "S", pay_mode: "regular",
  people: { name: "飛哥" }, vehicles: null, tasks: { title: "晶心 裝監視器", sites: null }, ...over,
});
const frow = (over: Partial<FollowRow> & { id: string }): FollowRow => ({
  title: "回覆內湖店", status: "to_reply", priority: "normal", contact: null, note: null, due_date: null, waiting_since: null,
  created_at: "2026-11-09T00:00:00Z", completed_at: null, site_id: null, sites: null, ...over,
});
const view = (rows: AssignmentRow[], date = TODAY, leaves: string[] = []) => shapeToday(date, rows, leaves);

describe("10:00 arrival check", () => {
  it("asks whether people arrived and lists today's jobs", () => {
    const r = buildArrive({ todayView: view([arow(), arow({ people: { name: "阿倫" } })]), liffId: "L1" });
    expect(r.send).toBe(true);
    expect(r.text).toContain("10:00 抵達確認");
    expect(r.text).toContain("・09:00–12:00 晶心 裝監視器（飛哥、阿倫）");
    expect(r.text).toContain("現場人員都到了嗎");
    expect(JSON.stringify(r.flex)).toContain("https://liff.line.me/L1/today");
  });
  it("stays quiet when nothing is scheduled today", () => {
    expect(buildArrive({ todayView: view([]) })).toMatchObject({ send: false, skipReason: "今天沒有排班" });
  });
});

describe("16:00 completion check", () => {
  const follow = (rows: FollowRow[]) => shapeFollowups(rows, TODAY);
  it("asks whether today's work is done", () => {
    const r = buildDone({ todayView: view([arow()]), follow: follow([]) });
    expect(r.send).toBe(true);
    expect(r.text).toContain("今天的工作都完成了嗎");
  });
  it("lists flexible-hold items that are due today, overdue or urgent as decisions to make", () => {
    const r = buildDone({
      todayView: view([]),
      follow: follow([
        frow({ id: "1", title: "元式鐵捲門維修", status: "flexible_hold", due_date: "2026-11-10" }),
        frow({ id: "2", title: "逾期的", status: "flexible_hold", due_date: "2026-11-08" }),
        frow({ id: "3", title: "不急的", status: "flexible_hold", due_date: "2026-11-20" }),
      ]),
    });
    expect(r.send).toBe(true); // 沒排班，但有要決定的事
    expect(r.text).toContain("機動待辦，今天要決定");
    expect(r.text).toContain("・元式鐵捲門維修（今天到期）");
    expect(r.text).toContain("・逾期的（已逾期 2 天）");
    expect(r.text).not.toContain("不急的");
  });
  it("stays quiet with no jobs and nothing to decide", () => {
    expect(buildDone({ todayView: view([]), follow: follow([]) }).send).toBe(false);
  });
});

describe("20:00 tomorrow preview", () => {
  const follow = (rows: FollowRow[]) => shapeFollowups(rows, TODAY);
  const tomorrow = "2026-11-11"; // 週三
  const input = (o: Partial<Parameters<typeof buildEvening>[0]> = {}) => ({ tomorrow, tomorrowView: view([], tomorrow), follow: follow([]), unassignedTomorrow: [], ...o });

  it("previews tomorrow's jobs, who is on leave and what still has no one assigned", () => {
    const r = buildEvening(
      input({
        tomorrowView: view([arow({ work_date: tomorrow })], tomorrow, ["楊東翰"]),
        unassignedTomorrow: ["內湖店 檢查監視器"],
        follow: follow([frow({ id: "u", title: "要不要吃晚餐", priority: "high" }), frow({ id: "n", title: "一般的事" })]),
        liffId: "L1",
      }),
    );
    expect(r.send).toBe(true);
    expect(r.text).toContain("20:00 明日預覽：11/11（三）");
    expect(r.text).toContain("【明天的工作（1）】");
    expect(r.text).toContain("【明天請假】\n楊東翰");
    expect(r.text).toContain("【明天還沒排人的工作】\n・內湖店 檢查監視器");
    expect(r.text).toContain("待我回覆 2 件");
    expect(r.text).toContain("其中 1 件是急件、已逾期或等太久：要不要吃晚餐");
    expect(JSON.stringify(r.flex)).toContain("https://liff.line.me/L1/board");
  });
  it("on a workday with nothing planned it still nudges", () => {
    const r = buildEvening(input());
    expect(r.send).toBe(true);
    expect(r.text).toContain("明天還沒有排定的工作");
  });
  it("is quiet when tomorrow is a weekend or holiday and nothing is planned or urgent; speaks when something is", () => {
    const sat = "2026-11-14";
    const quiet = buildEvening({ tomorrow: sat, tomorrowView: view([], sat), follow: follow([]), unassignedTomorrow: [] });
    expect(quiet.send).toBe(false);
    expect(quiet.skipReason).toContain("週末");
    const holiday = buildEvening({ tomorrow: "2026-02-17", tomorrowView: view([], "2026-02-17"), follow: follow([]), unassignedTomorrow: [] });
    expect(holiday.send).toBe(false);
    expect(holiday.skipReason).toContain("春節");
    expect(buildEvening({ tomorrow: sat, tomorrowView: view([arow({ work_date: sat })], sat), follow: follow([]), unassignedTomorrow: [] }).send).toBe(true);
    expect(buildEvening({ tomorrow: sat, tomorrowView: view([], sat), follow: follow([frow({ id: "u", priority: "high" })]), unassignedTomorrow: [] }).send).toBe(true);
  });
  it("computes tomorrow across month and year ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

import { restDaySkip } from "../lib/reminders.js";
describe("假日只送早晨簡報", () => {
  it("週末與國定假日：抵達／完工／明日預覽都不送，早晨簡報照常", () => {
    for (const d of ["2026-11-14", "2026-11-15", "2026-10-10"]) {
      expect(restDaySkip("arrive", d)).toBeTruthy();
      expect(restDaySkip("done", d)).toBeTruthy();
      expect(restDaySkip("evening", d)).toBeTruthy();
      expect(restDaySkip("morning", d)).toBeNull();
    }
  });
  it("平日全部照常", () => {
    for (const k of ["morning", "arrive", "done", "evening"] as const) expect(restDaySkip(k, "2026-11-12")).toBeNull();
  });
});
