import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listDays, onBoard, rangeFor, shapeBoard, type BoardAssignment, type BoardPerson } from "../lib/board.js";

const person = (id: string, name: string, over: Partial<BoardPerson> = {}): BoardPerson => ({
  id, name, nickname: null, role: "field", active: true, sort_order: 100, constraints: {}, ...over,
});
const A = (person_id: string, work_date: string, over: Partial<BoardAssignment> = {}): BoardAssignment => ({
  person_id, work_date, start_time: null, end_time: null, kind: "S", vehicles: null,
  tasks: { title: "晶心 裝監視器", sites: { name: "晶心" } }, ...over,
});

describe("rangeFor / listDays", () => {
  it("weeks start on Monday", () => {
    expect(rangeFor("week", "2026-11-11")).toEqual({ from: "2026-11-09", to: "2026-11-15", label: "11/9–11/15" });
    expect(rangeFor("week", "2026-11-15").from).toBe("2026-11-09"); // 週日屬於前一個週一開始的那週
    expect(rangeFor("week", "2026-11-09").from).toBe("2026-11-09");
    expect(rangeFor("week", "2027-03-03").label).toBe("3/1–3/7"); // 個位數月份與日期都不補 0
    expect(rangeFor("week", "2026-12-30").label).toBe("12/28–1/3"); // 跨年
  });
  it("months cover the 1st to the last day, including February and year changes", () => {
    expect(rangeFor("month", "2026-11-20")).toEqual({ from: "2026-11-01", to: "2026-11-30", label: "2026 年 11 月" });
    expect(rangeFor("month", "2027-02-10").to).toBe("2027-02-28");
    expect(rangeFor("month", "2026-12-31").to).toBe("2026-12-31");
  });
  it("flags weekends and today", () => {
    const d = listDays("2026-11-09", "2026-11-15", "2026-11-10");
    expect(d).toHaveLength(7);
    expect(d[1]).toMatchObject({ date: "2026-11-10", weekday: "二", today: true, weekend: false });
    expect(d[5].weekend && d[6].weekend).toBe(true);
  });
});

describe("who appears on the board", () => {
  it("keeps owner, field and outsourced; drops admin, inactive and rarely-on-site", () => {
    expect(onBoard(person("a", "A", { role: "owner" }))).toBe(true);
    expect(onBoard(person("b", "B", { role: "outsourced" }))).toBe(true);
    expect(onBoard(person("c", "C", { role: "admin" }))).toBe(false);
    expect(onBoard(person("d", "D", { active: false }))).toBe(false);
    expect(onBoard(person("e", "E", { constraints: { rarely_on_site: true } }))).toBe(false);
  });
});

describe("shapeBoard cell codes", () => {
  const TODAY = "2026-11-10"; // 週二
  const people = [
    person("fei", "張欽煌", { nickname: "飛哥", sort_order: 2 }),
    person("boss", "陳冠璋", { nickname: "冠璋", role: "owner", sort_order: 1 }),
    person("ze", "阿澤", { role: "outsourced", sort_order: 7, constraints: { daily_hire: true } }),
    person("zhen", "阿鎮", { role: "outsourced", sort_order: 8, constraints: { team_size: 4 } }),
    person("sheng", "李弘盛", { nickname: "阿盛", sort_order: 6, constraints: { no_solo: true } }),
  ];
  const v = (asg: BoardAssignment[], leaves: { person_id: string; leave_date: string }[] = []) =>
    shapeBoard("week", "2026-11-10", TODAY, people, asg, leaves);
  const code = (r: ReturnType<typeof v>, id: string, date: string) => {
    const i = r.days.findIndex((d) => d.date === date);
    return r.rows.find((x) => x.name === id)!.cells[i].code;
  };

  it("orders rows by sort_order, uses nicknames and subtitles", () => {
    const r = v([]);
    expect(r.rows.map((x) => x.name)).toEqual(["冠璋", "飛哥", "阿盛", "阿澤", "阿鎮"]);
    expect(r.rows.map((x) => x.sub)).toEqual(["老闆", "", "助手", "點工", "4 人·外包"]);
  });
  it("marks assigned future days with the work kind, past days as done", () => {
    const r = v([A("fei", "2026-11-11", { kind: "R" }), A("fei", "2026-11-09"), A("fei", "2026-11-12", { kind: "V" })]);
    expect(code(r, "飛哥", "2026-11-11")).toBe("R");
    expect(code(r, "飛哥", "2026-11-12")).toBe("V");
    expect(code(r, "飛哥", "2026-11-09")).toBe("C");
  });
  it("shows pending for free field staff, not-called for outsourced, rest on weekends, blank in the past", () => {
    const r = v([]);
    expect(code(r, "飛哥", "2026-11-11")).toBe("P");
    expect(code(r, "阿澤", "2026-11-11")).toBe("N");
    expect(code(r, "阿鎮", "2026-11-12")).toBe("N");
    expect(code(r, "飛哥", "2026-11-14")).toBe("-");
    expect(code(r, "飛哥", "2026-11-09")).toBe("");
    expect(code(r, "飛哥", "2026-11-10")).toBe("P"); // 今天也算
  });
  it("shows leave, and flags a conflict when someone on leave is still scheduled", () => {
    const r = v([A("sheng", "2026-11-12")], [{ person_id: "fei", leave_date: "2026-11-11" }, { person_id: "sheng", leave_date: "2026-11-12" }]);
    expect(code(r, "飛哥", "2026-11-11")).toBe("L");
    expect(code(r, "阿盛", "2026-11-12")).toBe("X");
    expect(r.rows.find((x) => x.name === "阿盛")!.cells[3].note).toContain("請假");
  });
  it("flags overlapping hours on the same day and keeps both items, earliest first", () => {
    const r = v([
      A("fei", "2026-11-11", { start_time: "11:00:00", end_time: "14:00:00", tasks: { title: "杜邦 施工", sites: null } }),
      A("fei", "2026-11-11", { start_time: "09:00:00", end_time: "12:00:00" }),
    ]);
    const cell = r.rows.find((x) => x.name === "飛哥")!.cells[2];
    expect(cell.code).toBe("X");
    expect(cell.items.map((i) => i.start)).toEqual(["09:00", "11:00"]);
  });
  it("does not flag back-to-back jobs or jobs without hours", () => {
    const back = v([A("fei", "2026-11-11", { start_time: "09:00:00", end_time: "12:00:00" }), A("fei", "2026-11-11", { start_time: "12:00:00", end_time: "15:00:00" })]);
    expect(back.rows.find((x) => x.name === "飛哥")!.cells[2].code).toBe("S");
    const none = v([A("fei", "2026-11-11"), A("fei", "2026-11-11")]);
    expect(none.rows.find((x) => x.name === "飛哥")!.cells[2].code).toBe("S");
  });
  it("counts pending people and conflicts per day", () => {
    const r = v([A("fei", "2026-11-11", { start_time: "09:00:00", end_time: "12:00:00" }), A("fei", "2026-11-11", { start_time: "10:00:00", end_time: "11:00:00" })]);
    const d11 = r.summary.find((s) => s.date === "2026-11-11")!;
    expect(d11.conflicts).toBe(1);
    expect(d11.pending).toBe(2); // 冠璋、阿盛仍待排（飛哥衝突、外包是未叫工）
    expect(r.summary.find((s) => s.date === "2026-11-14")).toMatchObject({ pending: 0, conflicts: 0 });
  });
});

describe("the board page", () => {
  const html = readFileSync(new URL("../liff/board.html", import.meta.url), "utf8");
  it("never writes API data with innerHTML", () => {
    expect(html).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
  });
  it("authenticates with the ID token and calls the board API", () => {
    expect(html).toContain("liff.getIDToken()");
    expect(html).toContain("/api/liff/board");
    expect(html).toContain("Authorization");
  });
  it("shows Chinese symbols on the cells, keeps pending cells empty, and explains every code in the legend", () => {
    expect(html).toContain("b.textContent = SYMBOL[cell.code]");
    const want = { S: "工", R: "修", V: "勘", P: "", L: "假", X: "❌", C: "✅", N: "未" };
    for (const [k, v] of Object.entries(want)) expect(html).toContain(`${k}: '${v}'`);
    for (const label of ["施工", "維修", "場勘／會議", "待排", "請假", "衝突", "已完成", "未叫工"]) expect(html).toContain(`'${label}'`);
    expect(html).toContain("待排（黃底空白）");
  });
  it("every cell still carries its meaning for screen readers", () => {
    expect(html).toContain("b.setAttribute('aria-label'");
    expect(html).toContain("(LABEL[cell.code] || '')");
  });
  it("has accessible controls and a link to today's work", () => {
    expect(html).toContain('aria-label="上一頁"');
    expect(html).toContain('aria-label="下一頁"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain("min-height:44px");
    expect(html).toContain('href="/liff/today"');
  });
});
