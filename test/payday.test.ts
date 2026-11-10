import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shapeBoard, type BoardAssignment, type BoardPerson } from "../lib/board.js";
import { confirmCard } from "../lib/flex.js";
import { HOLIDAYS } from "../lib/holidays.js";
import { shapeAvailable, shapePool } from "../lib/pool.js";
import { suggestPeople, type PoolTask } from "../lib/suggest.js";
import { shapeToday, type AssignmentRow } from "../lib/today.js";
import type { DraftItem } from "../lib/types.js";

const P = (id: string, name: string, over: Partial<BoardPerson> = {}): BoardPerson => ({
  id, name, nickname: name, role: "field", active: true, sort_order: 10, constraints: {}, ...over,
});
const people = [
  P("boss", "冠璋", { role: "owner", sort_order: 1 }),
  P("fei", "飛哥", { sort_order: 2 }),
  P("lun", "阿倫", { sort_order: 3 }),
  P("jie", "阿杰", { sort_order: 5, constraints: { avoid_weekend: true } }),
  P("ze", "阿澤", { role: "outsourced", sort_order: 7, constraints: { daily_hire: true } }),
];
const task = (over: Partial<PoolTask> = {}): PoolTask => ({
  id: "t1", title: "晶心 裝監視器", work: "裝監視器", site: "晶心", priority: "normal", wanted_date: "2026-11-11",
  headcount: 2, start_time: null, end_time: null, created_at: "2026-11-10T00:00:00Z", ...over,
});

describe("suggestions on holidays", () => {
  it("are allowed, marked as daily pay, and skip people who avoid holidays", () => {
    const s = suggestPeople(task({ wanted_date: "2026-02-17", headcount: 3 }), people, new Set(), new Map());
    expect(s.daily).toBe(true);
    expect(s.names).not.toContain("阿杰");
    expect(s.reason).toContain("點工");
    expect(s.names.length).toBeGreaterThan(0);
  });
  it("on a weekend too; ordinary weekdays are not daily and may include 阿杰", () => {
    expect(suggestPeople(task({ wanted_date: "2026-11-14" }), people, new Set(), new Map()).daily).toBe(true);
    const wk = suggestPeople(task({ wanted_date: "2026-11-11", headcount: 4 }), people, new Set(), new Map());
    expect(wk.daily).toBe(false);
    expect(wk.names).toContain("阿杰");
    expect(wk.reason).not.toContain("點工");
  });
});

describe("pool and availability on holidays", () => {
  it("lists a holiday in the availability view only when a pool task wants that day", () => {
    const none = shapeAvailable("2026-02-13", 7, people, new Set(), []);
    expect(none.map((d) => d.date)).not.toContain("2026-02-17");
    const wanted = shapeAvailable("2026-02-13", 7, people, new Set(), [task({ wanted_date: "2026-02-17" })]);
    const d = wanted.find((x) => x.date === "2026-02-17")!;
    expect(d).toMatchObject({ rest: true, demand: 2 });
    expect(d.free).not.toContain("阿杰");
  });
  it("marks ordinary workdays as not rest", () => {
    expect(shapeAvailable("2026-11-09", 3, people, new Set(), []).every((d) => d.rest === false)).toBe(true);
  });
  it("pool cards carry the daily flag from the suggestion", () => {
    const cards = shapePool([task({ wanted_date: "2026-02-17" })], people, new Set(), []);
    expect(cards[0].suggestion.daily).toBe(true);
  });
});

describe("the 點 marker shows up where people look", () => {
  const asg = (date: string, pay: string | null): BoardAssignment => ({
    person_id: "fei", work_date: date, start_time: null, end_time: null, kind: "S", pay_mode: pay, vehicles: null,
    tasks: { title: "晶心 裝監視器", sites: null },
  });
  it("board cells and their items are flagged daily", () => {
    const v = shapeBoard("week", "2026-11-14", "2026-11-10", people, [asg("2026-11-14", "daily"), asg("2026-11-11", "regular")], []);
    const fei = v.rows.find((r) => r.name === "飛哥")!;
    const sat = fei.cells[v.days.findIndex((d) => d.date === "2026-11-14")];
    const wed = fei.cells[v.days.findIndex((d) => d.date === "2026-11-11")];
    expect(sat).toMatchObject({ code: "S", daily: true });
    expect(sat.items[0].daily).toBe(true);
    expect(wed.daily).toBe(false);
  });
  it("the today view flags a daily card", () => {
    const row = (pay: string): AssignmentRow => ({
      task_id: "t", work_date: "2026-11-14", start_time: null, end_time: null, kind: "S", pay_mode: pay,
      people: { name: "飛哥" }, vehicles: null, tasks: { title: "晶心 裝監視器", sites: null },
    });
    expect(shapeToday("2026-11-14", [row("daily")], []).groups[0].daily).toBe(true);
    expect(shapeToday("2026-11-10", [row("regular")], []).groups[0].daily).toBe(false);
  });
  const item = (date: string): DraftItem => ({
    site: "晶心", work: "施工", date, time_slot: null, people: [], vehicle: null, headcount: null, priority: "normal",
    fixed: false, uncertain: [], person_ids: ["fei", "lun"], person_names: ["飛哥", "阿倫"], unknown_people: [],
  });
  it("the confirm card shows a red-background 點 badge for holiday work and nothing for workdays", () => {
    const hol = JSON.stringify(confirmCard("D1", [item("2026-02-17")]));
    expect(hol).toContain("#C62828");
    expect(hol).toContain("假日出勤（點工）");
    const sat = JSON.stringify(confirmCard("D1", [item("2026-11-14")]));
    expect(sat).toContain("#C62828");
    expect(JSON.stringify(confirmCard("D1", [item("2026-11-11")]))).not.toContain("#C62828");
  });
  it("both pages use a red badge with white text and the board legend explains it", () => {
    const board = readFileSync(new URL("../liff/board.html", import.meta.url), "utf8");
    const today = readFileSync(new URL("../liff/today.html", import.meta.url), "utf8");
    for (const html of [board, today]) expect(html).toMatch(/\.dian\{[^}]*background:#C62828;color:#fff/);
    expect(board).toContain("點 假日出勤（點工）");
    expect(board).not.toContain("th.hd.hol"); // 假日本身不特別強調
  });
});

describe("payroll data is stored with every assignment", () => {
  it("the migration adds queryable columns and backfills every holiday in the calendar", () => {
    const sql = readFileSync(new URL("../supabase/migrations/0008_pay_mode.sql", import.meta.url), "utf8");
    expect(sql).toContain("day_type");
    expect(sql).toContain("pay_mode");
    for (const d of Object.keys(HOLIDAYS)) expect(sql).toContain(`'${d}'`);
  });
  it("both write paths (confirm card and pool) store day_type and pay_mode", () => {
    for (const f of ["../lib/handlers.ts", "../lib/poolActions.ts"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src, f).toMatch(/day_type:\s*dayInfo\(/);
      expect(src, f).toMatch(/pay_mode:\s*dayInfo\(/);
    }
  });
});
