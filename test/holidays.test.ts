import { describe, expect, it } from "vitest";
import { shapeBoard, type BoardPerson } from "../lib/board.js";
import { CALENDAR_YEARS, HOLIDAYS, MAKEUP_WORKDAYS, dayInfo, hasCalendar, holidayName, isRestDay } from "../lib/holidays.js";
import { evaluateItems, type RuleContext } from "../lib/rules.js";
import type { DraftItem } from "../lib/types.js";

const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

describe("holiday data integrity", () => {
  it("only lists real calendar dates that fall on weekdays (weekends are automatic)", () => {
    for (const d of Object.keys(HOLIDAYS)) {
      expect(new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10)).toBe(d);
      expect([1, 2, 3, 4, 5], d).toContain(dow(d));
      expect(CALENDAR_YEARS).toContain(Number(d.slice(0, 4)));
    }
  });
  it("has the expected number of weekday holidays per year (checked against the official calendars)", () => {
    const n = (y: string) => Object.keys(HOLIDAYS).filter((d) => d.startsWith(y)).length;
    expect(n("2026")).toBe(16);
    expect(n("2027")).toBe(17);
  });
  it("matches known anchors: Spring Festival, National Day make-up day, year-end make-up day", () => {
    expect(holidayName("2026-02-17")).toBe("春節");
    expect(holidayName("2026-10-09")).toBe("國慶日補假");
    expect(holidayName("2027-12-31")).toBe("開國紀念日補假");
    expect(dow("2026-02-16")).toBe(1);
    expect(dow("2027-12-31")).toBe(5);
  });
  it("has no make-up workdays in the supplied calendars", () => {
    expect(MAKEUP_WORKDAYS).toEqual([]);
  });
});

describe("isRestDay / hasCalendar", () => {
  it("treats weekends and national holidays as rest days, ordinary weekdays as work days", () => {
    expect(isRestDay("2026-11-14")).toBe(true); // 週六
    expect(isRestDay("2026-11-15")).toBe(true); // 週日
    expect(isRestDay("2026-02-17")).toBe(true); // 春節
    expect(isRestDay("2026-11-10")).toBe(false);
    expect(isRestDay("2027-02-11")).toBe(false); // 春節後第一天上班
    expect(isRestDay("2027-09-15")).toBe(true); // 中秋節
  });
  it("falls back to weekends for years without data and says so", () => {
    expect(hasCalendar("2026-06-01")).toBe(true);
    expect(hasCalendar("2028-01-03")).toBe(false);
    expect(isRestDay("2028-01-03")).toBe(false); // 週一，沒資料就當上班日
    expect(isRestDay("2028-01-01")).toBe(true); // 週六
  });
});

const p = (id: string, name: string, over: Partial<BoardPerson> = {}): BoardPerson => ({
  id, name, nickname: name, role: "field", active: true, sort_order: 1, constraints: {}, ...over,
});

describe("the board on holidays", () => {
  const people = [p("a", "飛哥"), p("b", "阿澤", { role: "outsourced" })];
  it("shows rest on national holidays instead of pending / not-called, and carries the holiday name", () => {
    const v = shapeBoard("week", "2026-02-17", "2026-02-10", people, [], []);
    const feb17 = v.days.findIndex((d) => d.date === "2026-02-17");
    expect(v.days[feb17]).toMatchObject({ rest: true, weekend: false, holiday: "春節" });
    const fei = v.rows.find((r) => r.name === "飛哥")!;
    const ze = v.rows.find((r) => r.name === "阿澤")!;
    expect(fei.cells[feb17]).toMatchObject({ code: "-", note: "春節（國定假日）" });
    expect(ze.cells[feb17].code).toBe("-"); // 外包也不是「未叫工」
    expect(v.summary[feb17].pending).toBe(0);
    expect(v.calendarMissing).toBe(false);
  });
  it("still shows the assignment when someone is scheduled on a holiday", () => {
    const asg = [{ person_id: "a", work_date: "2026-02-17", start_time: null, end_time: null, kind: "R", vehicles: null, tasks: { title: "急修", sites: null } }];
    const v = shapeBoard("week", "2026-02-17", "2026-02-10", people, asg, []);
    const fei = v.rows.find((r) => r.name === "飛哥")!;
    expect(fei.cells[v.days.findIndex((d) => d.date === "2026-02-17")].code).toBe("R");
  });
  it("warns that holiday data is missing for years we do not have", () => {
    expect(shapeBoard("week", "2028-03-01", "2028-02-20", people, [], []).calendarMissing).toBe(true);
  });
});

describe("scheduling on holidays is allowed and not nagged about", () => {
  const people = new Map([
    ["fei", { id: "fei", name: "張欽煌", active: true, constraints: {} }],
    ["lun", { id: "lun", name: "莊岳倫", active: true, constraints: {} }],
    ["jie", { id: "jie", name: "王永杰", active: true, constraints: { avoid_weekend: true } }],
  ]);
  const ctx: RuleContext = { people, leaves: new Set(), existing: [] };
  const item = (date: string, ids: string[]): DraftItem => ({
    site: "晶心", work: "施工", date, time_slot: null, people: [], vehicle: null, headcount: null,
    priority: "normal", fixed: false, uncertain: [], person_ids: ids, person_names: [], unknown_people: [],
  });
  const lines = (it: DraftItem) => evaluateItems([it], ctx)[0].map((i) => i.text);

  it("no warning at all for a national holiday or a weekend (the red 點 badge marks it instead)", () => {
    expect(lines(item("2026-02-17", ["fei", "lun"]))).toEqual([]);
    expect(lines(item("2026-11-14", ["fei", "lun"]))).toEqual([]);
  });
  it("still applies the 'avoid weekend' preference to national holidays and weekends", () => {
    expect(lines(item("2026-02-17", ["jie", "fei"]))).toContain("王永杰 假日原則不排");
    expect(lines(item("2026-11-14", ["jie", "fei"]))).toContain("王永杰 假日原則不排");
    expect(lines(item("2026-11-10", ["jie", "fei"]))).toEqual([]);
  });
});

describe("dayInfo: what gets stored with each assignment for payroll", () => {
  it("workdays are regular pay", () => {
    expect(dayInfo("2026-11-10")).toEqual({ day_type: "workday", pay_mode: "regular", holiday: null });
  });
  it("weekends and national holidays are daily-hire (點工)", () => {
    expect(dayInfo("2026-11-14")).toEqual({ day_type: "weekend", pay_mode: "daily", holiday: null });
    expect(dayInfo("2026-11-15")).toMatchObject({ day_type: "weekend", pay_mode: "daily" });
    expect(dayInfo("2026-02-17")).toEqual({ day_type: "holiday", pay_mode: "daily", holiday: "春節" });
    expect(dayInfo("2027-12-31")).toMatchObject({ day_type: "holiday", pay_mode: "daily" });
  });
  it("years without calendar data still treat weekends as daily and weekdays as regular", () => {
    expect(dayInfo("2028-01-01").pay_mode).toBe("daily");
    expect(dayInfo("2028-01-03").pay_mode).toBe("regular");
  });
});
