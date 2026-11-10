import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractTasks } from "../lib/ai.js";
import { isEmptyItem } from "../lib/draft.js";
import { followCard, parsePostback } from "../lib/flex.js";
import { shapeFollowups, type FollowRow } from "../lib/followups.js";
import { sanitizeFollowUps } from "../lib/handlers.js";
import { formatFollowups, formatToday } from "../lib/summaries.js";
import { shapeToday } from "../lib/today.js";
import type { DraftItem, FollowUpDraft } from "../lib/types.js";

const item = (over: Partial<DraftItem> = {}): DraftItem => ({
  site: null, work: "待確認", date: null, time_slot: null, people: [], vehicle: null, headcount: null, priority: "normal",
  fixed: false, uncertain: ["site", "work", "date", "people"], ...over,
});

describe("no more blank confirmation cards", () => {
  it("treats the all-unknown item from the screenshot as empty", () => {
    expect(isEmptyItem(item())).toBe(true);
    expect(isEmptyItem(item({ work: "" }))).toBe(true);
  });
  it("keeps anything with at least one real detail", () => {
    expect(isEmptyItem(item({ site: "晶心" }))).toBe(false);
    expect(isEmptyItem(item({ work: "裝監視器", uncertain: ["site", "date", "people"] }))).toBe(false);
    expect(isEmptyItem(item({ work: "裝監視器" }))).toBe(true); // AI 自己標了「工作不確定」就不算數
    expect(isEmptyItem(item({ date: "2026-11-11" }))).toBe(false);
    expect(isEmptyItem(item({ people: ["飛哥"] }))).toBe(false);
  });
});

describe("the AI is told to tell questions from dispatches", () => {
  const capture = async (content: unknown) => {
    let body: any;
    const fake = (async (_u: unknown, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "submit_tasks", input: content }] }), { status: 200 });
    }) as typeof fetch;
    const out = await extractTasks({ text: "x", today: "2026-11-10", weekday: "二", aliases: ["飛哥"], sites: ["晶心"] }, "k", "m", fake);
    return { out, body };
  };
  it("asks for an intent and follow-ups in the tool schema, and explains the intents in the prompt", async () => {
    const { body } = await capture({ intent: "other", items: [], leaves: [], question: null });
    const props = body.tools[0].input_schema.properties;
    expect(props.intent.enum).toEqual(["dispatch", "ask_followups", "ask_today", "follow_up", "other"]);
    expect(body.tools[0].input_schema.required).toEqual(expect.arrayContaining(["intent", "follow_ups", "query_date"]));
    for (const w of ["ask_followups", "ask_today", "follow_up", "問句"]) expect(body.system).toContain(w);
    expect(body.system).toContain("絕對不要產生 items 或 follow_ups");
  });
  it("passes the intent, query date and follow-ups through, and defaults to dispatch for older replies", async () => {
    const fu = { title: "回覆內湖店", status: "to_reply", contact: "王經理", site: null, due_date: null, urgent: true };
    const a = await capture({ intent: "follow_up", query_date: null, follow_ups: [fu], items: [], leaves: [], question: null });
    expect(a.out).toMatchObject({ intent: "follow_up", follow_ups: [fu] });
    const b = await capture({ intent: "ask_today", query_date: "2026-11-12", items: [], leaves: [], question: null });
    expect(b.out).toMatchObject({ intent: "ask_today", query_date: "2026-11-12", follow_ups: [] });
    const c = await capture({ items: [], leaves: [], question: null });
    expect(c.out.intent).toBe("dispatch");
  });
});

describe("sanitizeFollowUps", () => {
  const fu = (over: Partial<FollowUpDraft> = {}): FollowUpDraft => ({ title: "回覆內湖店", status: "to_reply", contact: null, site: null, due_date: null, urgent: false, ...over });
  it("keeps valid entries, trims, and drops bad statuses or empty titles", () => {
    const out = sanitizeFollowUps([fu({ title: "  回覆  ", contact: " 王經理 " }), fu({ title: "   " }), fu({ status: "to_handle" as never }), fu({ due_date: "11/20" })]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: "回覆", contact: "王經理" });
    expect(out[1].due_date).toBeNull();
  });
  it("caps at 5 and survives undefined", () => {
    expect(sanitizeFollowUps(Array.from({ length: 9 }, () => fu()))).toHaveLength(5);
    expect(sanitizeFollowUps(undefined)).toEqual([]);
  });
});

const TODAY = "2026-11-10";
const row = (over: Partial<FollowRow> & { id: string }): FollowRow => ({
  title: "回覆內湖店", status: "to_reply", priority: "normal", contact: null, note: null, due_date: null, waiting_since: null,
  created_at: "2026-11-08T00:00:00Z", completed_at: null, site_id: null, sites: null, ...over,
});

describe("answering 「我有什麼要回覆的？」 in chat", () => {
  it("lists the three sections with urgency, contact, overdue and waiting days", () => {
    const text = formatFollowups(
      shapeFollowups(
        [
          row({ id: "1", title: "要不要吃晚餐", priority: "high", contact: "朋友" }),
          row({ id: "2", title: "廠商報價", status: "waiting_other", waiting_since: "2026-11-05T00:00:00Z", contact: "大同" }),
          row({ id: "3", title: "元式鐵捲門維修", status: "flexible_hold", due_date: "2026-11-08" }),
        ],
        TODAY,
      ),
    );
    expect(text).toContain("【待我回覆（1）】\n・要不要吃晚餐（急，對方：朋友）");
    expect(text).toContain("【等對方回覆（1）】\n・廠商報價（對方：大同，已等 5 天）");
    expect(text).toContain("【機動待辦（1）】\n・元式鐵捲門維修（已逾期 2 天）");
    expect(text).toContain("選單「待我回覆」");
  });
  it("says so when there is nothing, and caps long lists", () => {
    expect(formatFollowups(shapeFollowups([], TODAY))).toContain("目前沒有要追蹤的事");
    const many = Array.from({ length: 9 }, (_, i) => row({ id: String(i), title: `事${i}` }));
    const text = formatFollowups(shapeFollowups(many, TODAY));
    expect(text).toContain("【待我回覆（9）】");
    expect(text).toContain("…還有 3 件");
  });
});

describe("answering 「今天有什麼工作？」 in chat", () => {
  const asg = (over = {}) => ({ task_id: "t", work_date: "2026-11-10", start_time: "09:00:00", end_time: "12:00:00", kind: "S", pay_mode: "regular", people: { name: "飛哥" }, vehicles: { name: "ZINGER" }, tasks: { title: "晶心 裝監視器", sites: null }, ...over });
  it("lists time, job, people, vehicle and the 點 marker, plus who is on leave", () => {
    const view = shapeToday("2026-11-14", [asg({ work_date: "2026-11-14", pay_mode: "daily" }), asg({ people: { name: "阿倫" }, work_date: "2026-11-14", pay_mode: "daily" })], ["楊東翰"]);
    const text = formatToday(view, false);
    expect(text).toContain("11/14（六）的工作：");
    expect(text).toContain("・09:00–12:00 晶心 裝監視器（飛哥、阿倫｜ZINGER｜點）");
    expect(text).toContain("請假：楊東翰");
  });
  it("says there is nothing scheduled, and marks today", () => {
    const text = formatToday(shapeToday("2026-11-10", [], []), true);
    expect(text).toContain("11/10（二）今天還沒有排定的工作");
  });
});

describe("the follow-up confirmation card and its wiring", () => {
  const fu: FollowUpDraft = { title: "回覆內湖店要不要加做", status: "to_reply", contact: "王經理", site: "晶心", due_date: "2026-11-12", urgent: true };
  it("shows what will be tracked and has confirm / skip buttons carrying the draft id", () => {
    const card = JSON.stringify(followCard("D1", [fu]));
    expect(card).toContain("要加入追蹤嗎？");
    expect(card).toContain("回覆內湖店要不要加做");
    expect(card).toContain("待我回覆（急）");
    expect(card).toContain("王經理");
    expect(card).toContain("a=fconfirm&d=D1");
    expect(card).toContain("a=fskip&d=D1");
    expect(parsePostback("a=fconfirm&d=D1")).toMatchObject({ a: "fconfirm", d: "D1" });
  });
  it("the handler answers questions without creating drafts, and nothing is written before confirmation", () => {
    const src = readFileSync(new URL("../lib/handlers.ts", import.meta.url), "utf8");
    const ask = src.indexOf('extraction.intent === "ask_followups"');
    const firstInsert = src.indexOf('.from("drafts")\n      .insert');
    expect(ask).toBeGreaterThan(0);
    expect(ask).toBeLessThan(firstInsert); // 問句在建立任何草稿之前就回答完
    expect(src).toContain('pb.a === "fconfirm"');
    expect(src).toContain('pb.a === "fskip"');
  });
  it("the migration adds the draft column", () => {
    expect(readFileSync(new URL("../supabase/migrations/0012_draft_followups.sql", import.meta.url), "utf8")).toContain("follow_ups");
  });
});
