import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractEdits } from "../lib/ai.js";
import type { AliasMap } from "../lib/aliases.js";
import { applyEdits, describeItems } from "../lib/jobEdit.js";
import { confirmCard, editListCard, parsePostback } from "../lib/flex.js";
import { menuReply } from "../lib/menu.js";
import type { DraftItem } from "../lib/types.js";

const item = (over: Partial<DraftItem> = {}): DraftItem => ({
  site: "新店軍營", work: "待確認", date: "2026-11-11", time_slot: null, people: ["小張"], vehicle: null, headcount: 2, priority: "normal",
  fixed: false, uncertain: ["work"], person_ids: ["p1"], person_names: ["張欽堂"], unknown_people: [], ...over,
});
const aliases: AliasMap = new Map([
  ["阿哲", { id: "p2", name: "陳哲" }],
  ["小張", { id: "p1", name: "張欽堂" }],
]);

describe("冠璋在聊天室改工作內容", () => {
  it("補上工作內容，會清掉「待確認」", () => {
    const r = applyEdits([item()], [{ index: 1, work: "冷氣維修" }], aliases);
    expect(r.items[0].work).toBe("冷氣維修");
    expect(r.items[0].uncertain).not.toContain("work");
    expect(r.changed).toBe(true);
    expect(r.notes).toEqual(["第 1 項已修改：工作。"]);
  });
  it("改日期與時間；只說一個時間就只動開始時間", () => {
    const r = applyEdits([item({ start_time: "09:30", end_time: "12:00" })], [{ index: 1, date: "2026-11-12", start_time: "9:00" }], aliases);
    expect(r.items[0]).toMatchObject({ date: "2026-11-12", start_time: "09:00", end_time: "12:00" });
  });
  it("看不懂的日期、時間不會亂改，並告訴冠璋", () => {
    const r = applyEdits([item()], [{ index: 1, date: "下週", start_time: "九點半" }], aliases);
    expect(r.items[0].date).toBe("2026-11-11");
    expect(r.items[0].start_time).toBeUndefined();
    expect(r.changed).toBe(false);
    expect(r.notes.join("")).toContain("日期「下週」看不懂");
    expect(r.notes.join("")).toContain("時間「九點半」看不懂");
  });
  it("開始時間不早於結束時間會提醒", () => {
    const r = applyEdits([item()], [{ index: 1, start_time: "15:00", end_time: "13:00" }], aliases);
    expect(r.notes.join("")).toContain("不早於結束時間");
  });
  it("換人員：用別名字典對應，對不到的標待確認", () => {
    const r = applyEdits([item()], [{ index: 1, people: ["阿哲", "路人甲"] }], aliases);
    expect(r.items[0]).toMatchObject({ person_ids: ["p2"], person_names: ["陳哲"], unknown_people: ["路人甲"] });
  });
  it("改車輛會對應正式車名，改完就不再是特例", () => {
    const r = applyEdits([item({ vehicle: "CR-V", vehicle_special: true })], [{ index: 1, vehicle: "zinger" }], aliases);
    expect(r.items[0]).toMatchObject({ vehicle: "ZINGER", vehicle_special: false });
  });
  it("人數只收合理的整數", () => {
    expect(applyEdits([item()], [{ index: 1, headcount: 3 }], aliases).items[0].headcount).toBe(3);
    expect(applyEdits([item()], [{ index: 1, headcount: 99 }], aliases).items[0].headcount).toBeNull();
  });
  it("案場改成空白就變成待確認", () => {
    const r = applyEdits([item()], [{ index: 1, site: "  " }], aliases);
    expect(r.items[0].site).toBeNull();
    expect(r.items[0].uncertain).toContain("site");
  });
  it("多項時只改指定那項，其他不動；不存在的項次會說明", () => {
    const r = applyEdits([item({ site: "A" }), item({ site: "B" })], [{ index: 2, work: "施工" }, { index: 5, work: "x" }], aliases);
    expect(r.items.map((i) => i.work)).toEqual(["待確認", "施工"]);
    expect(r.notes).toContain("找不到第 5 項，沒有修改。");
  });
  it("新草稿的項目可以移除；已排進班表的不能在這裡移除", () => {
    expect(applyEdits([item(), item()], [{ index: 1, remove: true }], aliases).items).toHaveLength(1);
    const kept = applyEdits([item({ task_id: "t1" })], [{ index: 1, remove: true }], aliases);
    expect(kept.items).toHaveLength(1);
    expect(kept.notes.join("")).toContain("已經排進班表");
  });
  it("不會改動原本的資料（純函式）", () => {
    const before = [item()];
    applyEdits(before, [{ index: 1, work: "x", people: ["阿哲"] }], aliases);
    expect(before[0].work).toBe("待確認");
    expect(before[0].person_ids).toEqual(["p1"]);
  });
  it("給 AI 看的現況摘要有項次、案場、人員", () => {
    const d = describeItems([item({ work: "施工" })]);
    expect(d).toContain("第 1 項");
    expect(d).toContain("案場=新店軍營");
    expect(d).toContain("人員=張欽堂");
  });
});

describe("確認卡上的按鈕", () => {
  const labels = (c: any) => c.contents.footer.contents.map((b: any) => b.action.label);
  it("新增時有「修改內容」，修改已排工作時改成「確認修改」", () => {
    const add: any = confirmCard("d1", [item()]);
    expect(labels(add)).toEqual(["確認新增", "修改內容", "改派人員", "選擇車輛", "稍後處理"]);
    expect(add.contents.footer.contents[1].action.data).toBe("a=edit&d=d1");
    const edit: any = confirmCard("d2", [item({ task_id: "t1" })]);
    expect(labels(edit)[0]).toBe("確認修改");
    expect(edit.contents.header.contents[0].text).toContain("修改");
    expect(edit.altText).toContain("確認修改");
  });
  it("「修改工作」清單：每項一顆修改按鈕，最多 8 項", () => {
    const jobs = Array.from({ length: 11 }, (_, i) => ({ task_id: `t${i}`, title: `工作${i}`, date: "2026-11-12" }));
    const card: any = editListCard(jobs);
    expect(card.contents.body.contents).toHaveLength(8);
    const btn = card.contents.body.contents[0].contents[1];
    expect(parsePostback(btn.action.data)).toMatchObject({ a: "editjob", d: "t0" });
    expect(JSON.stringify(card)).toContain("11/12");
  });
});

describe("AI 修改指令", () => {
  const run = async (input: unknown) => {
    let body: any;
    const fake = (async (_u: unknown, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "submit_edits", input }] }), { status: 200 });
    }) as typeof fetch;
    const out = await extractEdits({ text: "改到明天 9 點", current: "第 1 項：…", today: "2026-11-10", weekday: "二", aliases: ["阿哲"], sites: ["晶心"] }, "k", "m", fake);
    return { out, body };
  };
  it("把目前卡片內容與規則放進提示，工具只收 edits 與 question", async () => {
    const { out, body } = await run({ edits: [{ index: 1, date: "2026-11-11", start_time: "09:00" }], question: null });
    expect(out.edits).toEqual([{ index: 1, date: "2026-11-11", start_time: "09:00" }]);
    expect(body.system).toContain("第 1 項：…");
    expect(body.system).toContain("沒提到的欄位不要放進 edits");
    expect(body.tools[0].name).toBe("submit_edits");
    expect(body.tools[0].input_schema.required).toEqual(["edits", "question"]);
    expect(body.messages[0].content).toBe("改到明天 9 點");
  });
  it("看不懂時回傳問題、不回傳修改", async () => {
    const { out } = await run({ edits: [], question: "要改第幾項？" });
    expect(out).toEqual({ edits: [], question: "要改第幾項？" });
  });
});

describe("說明與接線", () => {
  it("怎麼用說明提到修改", () => {
    const help = menuReply("怎麼用")!;
    expect(help).toContain("修改內容");
    expect(help).toContain("修改工作");
  });
  it("遷移檔加了 awaiting_edit_at，而且可重複執行", () => {
    const sql = readFileSync(new URL("../supabase/migrations/0013_edit_jobs.sql", import.meta.url), "utf8");
    expect(sql).toContain("add column if not exists awaiting_edit_at");
  });
  it("聊天室處理：修改指令、打「確認」、按鈕都接上了", () => {
    const h = readFileSync(new URL("../lib/handlers.ts", import.meta.url), "utf8");
    for (const w of ['pb.a === "edit"', 'pb.a === "editjob"', "tryEdit(", "confirmDraft(", "latestOpenDraft(", "saveEditedTask("]) expect(h).toContain(w);
  });
});
