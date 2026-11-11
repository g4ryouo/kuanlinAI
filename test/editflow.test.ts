import { beforeEach, describe, expect, it, vi } from "vitest";

/** 把 supabase 的鏈式呼叫記下來，並依資料表與動作回傳事先指定的資料 */
interface Call { table: string; op: string; payload?: unknown; filters: [string, unknown][]; single?: boolean }
const calls: Call[] = [];
let respond: (c: Call) => { data?: unknown; error?: unknown } = () => ({ data: null });

vi.mock("../lib/db.js", () => ({
  db: () => ({
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      const chain: any = new Proxy(function () {}, {
        get(_t, prop: string) {
          if (prop === "then") {
            calls.push(call);
            const r = respond(call);
            return (res: (v: unknown) => void) => res({ data: r.data ?? null, error: r.error ?? null });
          }
          return (...args: unknown[]) => {
            if (["insert", "update", "delete"].includes(prop)) {
              call.op = prop;
              call.payload = args[0];
            } else if (["eq", "in", "gte", "or", "is"].includes(prop)) call.filters.push([prop, args]);
            if (prop === "single" || prop === "maybeSingle") {
              call.single = true;
              calls.push(call);
              const r = respond(call);
              return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
            }
            return chain;
          };
        },
      });
      return chain;
    },
  }),
}));

import { draftItemFromTask, listEditableJobs, saveEditedTask } from "../lib/editFlow.js";
import type { DraftItem } from "../lib/types.js";

const TID = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const item = (over: Partial<DraftItem> = {}): DraftItem => ({
  site: "國泰", work: "冷氣維修", date: "2026-11-12", time_slot: null, people: [], vehicle: "ZINGER", headcount: 2, priority: "normal",
  fixed: false, start_time: "09:00", end_time: "12:00", uncertain: [], person_ids: ["p1", "p2"], person_names: ["甲", "乙"], unknown_people: [], task_id: TID, ...over,
});

beforeEach(() => {
  calls.length = 0;
  respond = () => ({ data: null });
});

describe("修改已經排好的工作", () => {
  it("先寫入新的排班、再刪舊的，原本的排班不會在中途失敗時消失", async () => {
    respond = (c) => (c.table === "assignments" && c.op === "select" ? { data: [{ id: "old1" }, { id: "old2" }] } : { data: null });
    const r = await saveEditedTask(item(), new Map([["ZINGER", "v1"]]));
    expect(r.people).toBe(2);
    const ops = calls.filter((c) => c.table === "assignments").map((c) => c.op);
    expect(ops).toEqual(["select", "insert", "delete"]);
    const ins = calls.find((c) => c.op === "insert")!.payload as any[];
    expect(ins.map((x) => x.person_id)).toEqual(["p1", "p2"]);
    expect(ins[0]).toMatchObject({ task_id: TID, work_date: "2026-11-12", start_time: "09:00", end_time: "12:00", vehicle_id: "v1", kind: "R", day_type: "workday" });
    expect(calls.find((c) => c.op === "delete")!.filters).toEqual([["in", ["id", ["old1", "old2"]]]]);
  });
  it("更新的是原本那筆工作，不是新增；只改還沒做完的", async () => {
    await saveEditedTask(item({ work: "施工" }), new Map());
    const up = calls.find((c) => c.table === "tasks" && c.op === "update")!;
    expect(up.payload).toMatchObject({ title: "國泰 施工", work: "施工", wanted_date: "2026-11-12", headcount: 2, start_time: "09:00", end_time: "12:00" });
    expect(up.filters).toEqual(expect.arrayContaining([["eq", ["id", TID]], ["eq", ["status", "to_handle"]]]));
    expect(calls.some((c) => c.table === "tasks" && c.op === "insert")).toBe(false);
  });
  it("改到假日，點工標記會跟著重算", async () => {
    await saveEditedTask(item({ date: "2026-11-14" }), new Map()); // 週六
    const ins = calls.find((c) => c.op === "insert")!.payload as any[];
    expect(ins[0]).toMatchObject({ day_type: "weekend", pay_mode: "daily" });
  });
  it("人員或日期被清掉：舊排班移除、不再寫入新的（回到待排池）", async () => {
    respond = (c) => (c.table === "assignments" && c.op === "select" ? { data: [{ id: "old1" }] } : { data: null });
    const r = await saveEditedTask(item({ person_ids: [] }), new Map());
    expect(r.people).toBe(0);
    expect(calls.some((c) => c.op === "insert")).toBe(false);
    expect(calls.some((c) => c.op === "delete")).toBe(true);
  });
  it("寫入新排班失敗就丟出錯誤，而且不會刪掉舊的", async () => {
    respond = (c) =>
      c.table === "assignments" && c.op === "select" ? { data: [{ id: "old1" }] } : c.table === "assignments" && c.op === "insert" ? { error: new Error("boom") } : { data: null };
    await expect(saveEditedTask(item(), new Map())).rejects.toThrow("boom");
    expect(calls.some((c) => c.op === "delete")).toBe(false);
  });
  it("不是修改項目就拒絕", async () => {
    await expect(saveEditedTask(item({ task_id: undefined }), new Map())).rejects.toThrow();
  });
});

describe("從已排的工作還原成卡片", () => {
  const task = {
    id: TID, title: "國泰 冷氣維修", work: "冷氣維修", priority: "high", wanted_date: "2026-11-12", headcount: 2, start_time: null, end_time: null, status: "to_handle",
    sites: { name: "國泰" },
    assignments: [
      { person_id: "p1", work_date: "2026-11-12", start_time: "09:00:00", end_time: "12:00:00", fixed: false, people: { name: "甲" }, vehicles: { name: "ZINGER" } },
      { person_id: "p2", work_date: "2026-11-12", start_time: "09:00:00", end_time: "12:00:00", fixed: false, people: { name: "乙" }, vehicles: { name: "ZINGER" } },
    ],
  };
  it("帶回案場、工作、日期、時間、人員、車輛，並標上 task_id", async () => {
    respond = () => ({ data: task });
    const it = await draftItemFromTask(TID);
    expect(it).toMatchObject({ site: "國泰", work: "冷氣維修", date: "2026-11-12", start_time: "09:00", end_time: "12:00", person_ids: ["p1", "p2"], person_names: ["甲", "乙"], vehicle: "ZINGER", headcount: 2, priority: "high", task_id: TID });
  });
  it("還在待排池（沒人）的工作也能改：用工作自己的日期", async () => {
    respond = () => ({ data: { ...task, assignments: [], start_time: "13:00:00", end_time: null } });
    expect(await draftItemFromTask(TID)).toMatchObject({ date: "2026-11-12", start_time: "13:00", person_ids: [] });
  });
  it("已完成或取消的、找不到的、格式不對的都回 null", async () => {
    respond = () => ({ data: { ...task, status: "done" } });
    expect(await draftItemFromTask(TID)).toBeNull();
    respond = () => ({ data: null });
    expect(await draftItemFromTask(TID)).toBeNull();
    expect(await draftItemFromTask("not-a-uuid")).toBeNull();
  });
});

describe("列出可以修改的工作", () => {
  it("只列今天起的、還沒做完的排班工作（不含追蹤事項）", async () => {
    respond = () => ({
      data: [
        { id: "a", title: "已過去", wanted_date: "2026-11-01", assignments: [] },
        { id: "b", title: "今天", wanted_date: "2026-11-10", assignments: [] },
        { id: "c", title: "沒定日期", wanted_date: null, assignments: [] },
        { id: "d", title: "只有排班日期", wanted_date: null, assignments: [{ work_date: "2026-11-15" }] },
      ],
    });
    const jobs = await listEditableJobs("2026-11-10");
    expect(jobs.map((j) => j.task_id)).toEqual(["b", "c", "d"]);
    expect(jobs[2].date).toBe("2026-11-15");
    const q = calls[0];
    expect(q.filters).toEqual(expect.arrayContaining([["eq", ["status", "to_handle"]], ["eq", ["follow_up", false]]]));
  });
});


// ---- 整條聊天室流程：按「修改內容」→ 一句話 → 卡片更新 ----
import { handleMessage, handlePostback } from "../lib/handlers.js";

describe("聊天室：修改內容", () => {
  const sent: { url: string; body: any }[] = [];
  const draftItem = (): DraftItem => ({
    site: "國泰", work: "待確認", date: "2026-11-11", time_slot: null, people: [], vehicle: null, headcount: 2, priority: "normal",
    fixed: false, uncertain: ["work"], person_ids: ["p1"], person_names: ["張欽堂"], unknown_people: [],
  });
  const ev = (message: unknown) => ({ replyToken: "rt", source: { userId: "U1" }, message }) as any;

  beforeEach(() => {
    sent.length = 0;
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "t";
    respond = (c) => {
      if (c.table === "aliases") return { data: [{ alias: "阿哲", people: { id: "p2", name: "陳哲" } }] };
      if (c.table === "sites") return { data: [{ name: "國泰" }] };
      if (c.table === "people") return { data: [{ id: "p1", name: "張欽堂", active: true, constraints: {} }, { id: "p2", name: "陳哲", active: true, constraints: {} }] };
      if (c.table === "drafts" && c.op === "select" && c.single && c.filters.some((f) => JSON.stringify(f).includes("awaiting_edit_at")) === false) return { data: null };
      if (c.table === "drafts" && c.op === "select") return { data: { id: "d1", items: [draftItem()], leaves: [] } };
      return { data: null };
    };
    vi.stubGlobal("fetch", (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      sent.push({ url: String(url), body });
      if (String(url).includes("anthropic")) {
        const input = body.tools?.[0]?.name === "submit_edits" ? { edits: [{ index: 1, work: "冷氣維修", people: ["阿哲"] }], question: null } : { items: [], leaves: [], question: null };
        return new Response(JSON.stringify({ content: [{ type: "tool_use", name: body.tools[0].name, input }] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch);
  });

  it("按「修改內容」：記下等待修改，並告訴冠璋怎麼說", async () => {
    respond = (c) => (c.table === "drafts" && c.op === "update" ? { data: { id: "d1" } } : { data: null });
    await handlePostback({ replyToken: "rt", source: { userId: "U1" }, postback: { data: "a=edit&d=d1" } } as any);
    const up = calls.find((c) => c.table === "drafts" && c.op === "update")!;
    expect(up.payload).toMatchObject({ awaiting_work_at: null });
    expect((up.payload as any).awaiting_edit_at).toBeTruthy();
    const reply = sent.find((s) => s.url.includes("/reply"))!;
    expect(reply.body.messages[0].text).toContain("工作改成");
    expect(reply.body.messages[0].text).toContain("10 分鐘");
  });

  it("等待修改時，下一句話會改掉那張卡，並重新顯示確認卡", async () => {
    await handleMessage(ev({ type: "text", id: "m1", text: "工作是冷氣維修，人換成阿哲" }), null);
    const reply = sent.find((s) => s.url.includes("/reply"))!;
    expect(reply.body.messages[0].text).toContain("第 1 項已修改：工作、人員");
    const card = reply.body.messages[1];
    expect(card.type).toBe("flex");
    expect(JSON.stringify(card)).toContain("冷氣維修");
    expect(JSON.stringify(card)).toContain("陳哲");
    expect(JSON.stringify(card)).not.toContain("內容待確認");
    const saved = calls.find((c) => c.table === "drafts" && c.op === "update")!.payload as any;
    expect(saved.items[0]).toMatchObject({ work: "冷氣維修", person_ids: ["p2"] });
    expect(saved.awaiting_edit_at).toBeTruthy(); // 重新計時，可以接著改
  });

  it("沒有在等待修改時，同一句話走一般派工流程（不呼叫修改）", async () => {
    respond = (c) => (c.table === "aliases" ? { data: [] } : c.table === "sites" ? { data: [] } : { data: null });
    await handleMessage(ev({ type: "text", id: "m1", text: "今天天氣真好" }), null);
    const names = sent.filter((s) => s.url.includes("anthropic")).map((s) => s.body.tools[0].name);
    expect(names).toEqual(["submit_tasks"]);
  });
});
