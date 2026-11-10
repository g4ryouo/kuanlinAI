import { describe, expect, it } from "vitest";
import { extractTasks } from "../lib/ai.js";
import { resolveNames, type AliasMap } from "../lib/aliases.js";
import { MAX_PICK, compactId, confirmCard, expandId, leaveText, parsePostback, reassignQuickReply } from "../lib/flex.js";
import { headcountWarning, needsWork } from "../lib/draft.js";
import type { DraftItem } from "../lib/types.js";

const map: AliasMap = new Map([
  ["飛哥", { id: "p1", name: "張欽煌" }],
  ["阿飛", { id: "p1", name: "張欽煌" }],
  ["阿倫", { id: "p2", name: "莊岳倫" }],
]);

describe("resolveNames", () => {
  it("maps aliases to the same person and reports unknowns", () => {
    const r = resolveNames(["飛哥", "阿飛", "阿倫", "師傅"], map);
    expect(r.resolved.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(r.unknown).toEqual(["師傅"]);
  });
});

const item: DraftItem = {
  site: "晶心", work: "弱電施工", date: "2026-11-11", time_slot: "上午", people: ["飛哥", "師傅"],
  vehicle: null, headcount: 2, priority: "normal", fixed: false, uncertain: ["people"],
  person_ids: ["p1"], person_names: ["張欽煌"], unknown_people: ["師傅"],
};

describe("confirmCard", () => {
  it("has three postback buttons carrying the draft id and flags unknown people", () => {
    const card = JSON.stringify(confirmCard("D1", [item]));
    expect(card).toContain("a=confirm&d=D1");
    expect(card).toContain("a=reassign&d=D1");
    expect(card).toContain("a=later&d=D1");
    expect(card).toContain("師傅（待確認）");
  });
  it("parses postback data", () => {
    expect(parsePostback("a=assign&d=D1&p=P9")).toEqual({ a: "assign", d: "D1", p: "P9" });
    expect(parsePostback("garbage")).toBeNull();
  });
});

describe("work unknown and leave notes", () => {
  it("shows unknown work as 內容待確認 instead of an invented description", () => {
    const card = JSON.stringify(confirmCard("D1", [{ ...item, work: "待確認", uncertain: ["work"] }]));
    expect(card).toContain("內容待確認");
    expect(card).not.toContain("施工");
  });
  it("renders a leave note on the card and as plain text", () => {
    const leaves = [{ person: "阿東", date: "2026-11-11", person_name: "楊東翰" }];
    expect(leaveText(leaves)).toContain("楊東翰 2026-11-11");
    expect(leaveText(leaves)).toContain("不會寫入");
    expect(JSON.stringify(confirmCard("D1", [item], leaves))).toContain("偵測到請假");
    expect(leaveText([{ person: "師傅", date: null }])).toContain("師傅（待確認）");
  });
});

describe("extractTasks", () => {
  const input = { text: "明天飛哥去晶心", today: "2026-11-10", weekday: "二", aliases: ["飛哥"], sites: ["晶心"] };

  it("returns the tool_use payload using auto tool choice", async () => {
    let body: any;
    const fake = (async (_u: unknown, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "submit_tasks", input: { items: [item], leaves: [], question: null } }] }), { status: 200 });
    }) as typeof fetch;
    const r = await extractTasks(input, "k", "m", fake);
    expect(r.items[0].site).toBe("晶心");
    expect(body.tool_choice).toEqual({ type: "auto" });
    expect(body.system).toContain("2026-11-10");
  });

  it("retries once when the model skips the tool, then succeeds", async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      const content = calls === 1
        ? [{ type: "text", text: "好的" }]
        : [{ type: "tool_use", name: "submit_tasks", input: { items: [], leaves: [], question: null } }];
      return new Response(JSON.stringify({ content }), { status: 200 });
    }) as typeof fetch;
    expect(await extractTasks(input, "k", "m", fake)).toEqual({ intent: "dispatch", query_date: null, follow_ups: [], items: [], leaves: [], question: null });
    expect(calls).toBe(2);
  });

  it("throws if the model never calls the tool, and on API errors", async () => {
    const none = (async () => new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }] }), { status: 200 })) as typeof fetch;
    await expect(extractTasks(input, "k", "m", none)).rejects.toThrow("結構化");
    const bad = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    await expect(extractTasks(input, "k", "m", bad)).rejects.toThrow("500");
  });
});

describe("multi-select reassign", () => {
  const uid = (n: number) => `${String(n).padStart(8, "0")}-aaaa-bbbb-cccc-${String(n).padStart(12, "0")}`;
  const people = Array.from({ length: 9 }, (_, i) => ({ id: uid(i + 1), name: `人${i + 1}` }));
  const D = "11111111-2222-3333-4444-555555555555";

  it("round-trips ids", () => expect(expandId(compactId(uid(7)))).toBe(uid(7)));

  it("starts with no done button and lists everyone", () => {
    const m = reassignQuickReply(D, people) as any;
    expect(m.quickReply.items).toHaveLength(9);
    expect(JSON.stringify(m)).not.toContain("a=done");
  });

  it("after picking, hides picked people, shows the picked names and a done button", () => {
    const m = reassignQuickReply(D, people, people.slice(0, 2)) as any;
    expect(m.text).toContain("人1、人2");
    const labels = m.quickReply.items.map((i: any) => i.action.label);
    expect(labels).not.toContain("人1");
    expect(labels).toContain("完成");
    expect(JSON.stringify(m)).toContain("a=done");
  });

  it("keeps every postback under LINE's 300 char limit at the max selection and then only offers done", () => {
    const m = reassignQuickReply(D, people, people.slice(0, MAX_PICK)) as any;
    for (const i of m.quickReply.items) expect(i.action.data.length).toBeLessThanOrEqual(300);
    expect(m.quickReply.items).toHaveLength(1);
    const near = reassignQuickReply(D, people, people.slice(0, MAX_PICK - 1)) as any;
    for (const i of near.quickReply.items) expect(i.action.data.length).toBeLessThanOrEqual(300);
  });

  it("parses the selection back out of a pick postback", () => {
    const m = reassignQuickReply(D, people, people.slice(0, 2)) as any;
    const parsed = parsePostback(m.quickReply.items[0].action.data)!;
    expect(parsed.a).toBe("pick");
    expect(parsed.s!.split(",").map(expandId)).toEqual([uid(1), uid(2)]);
  });
});

describe("headcount check and required work", () => {
  it("warns when assigned count differs from the estimate, stays quiet otherwise", () => {
    expect(headcountWarning({ ...item, headcount: 2, person_ids: ["a", "b", "c"] })).toBe("原先預估 2 人，但指派了 3 人，請確認是否正確");
    expect(headcountWarning({ ...item, headcount: 2, person_ids: ["a", "b"] })).toBeNull();
    expect(headcountWarning({ ...item, headcount: null, person_ids: ["a"] })).toBeNull();
    expect(headcountWarning({ ...item, headcount: 2, person_ids: [] })).toBeNull();
  });
  it("shows the headcount reminder on the card", () => {
    const card = JSON.stringify(confirmCard("D1", [{ ...item, headcount: 2, person_ids: ["a", "b", "c"] }]));
    expect(card).toContain("原先預估 2 人，但指派了 3 人");
  });
  it("treats empty, 待確認 and uncertain work as missing", () => {
    expect(needsWork({ ...item, work: "待確認", uncertain: [] })).toBe(true);
    expect(needsWork({ ...item, work: " ", uncertain: [] })).toBe(true);
    expect(needsWork({ ...item, work: "弱電施工", uncertain: ["work"] })).toBe(true);
    expect(needsWork({ ...item, work: "弱電施工", uncertain: [] })).toBe(false);
  });
});
