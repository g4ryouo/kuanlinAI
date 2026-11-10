import { describe, expect, it } from "vitest";
import { extractTasks } from "../lib/ai.js";
import { resolveNames, type AliasMap } from "../lib/aliases.js";
import { confirmCard, parsePostback } from "../lib/flex.js";
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

describe("extractTasks", () => {
  const input = { text: "明天飛哥去晶心", today: "2026-11-10", weekday: "二", aliases: ["飛哥"], sites: ["晶心"] };

  it("returns the tool_use payload and forces the tool", async () => {
    let body: any;
    const fake = (async (_u: unknown, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "submit_tasks", input: { items: [item], question: null } }] }), { status: 200 });
    }) as typeof fetch;
    const r = await extractTasks(input, "k", "m", fake);
    expect(r.items[0].site).toBe("晶心");
    expect(body.tool_choice).toEqual({ type: "tool", name: "submit_tasks" });
    expect(body.system).toContain("2026-11-10");
  });

  it("returns empty on missing tool_use and throws on API error", async () => {
    const empty = (async () => new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }] }), { status: 200 })) as typeof fetch;
    expect(await extractTasks(input, "k", "m", empty)).toEqual({ items: [], question: null });
    const bad = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    await expect(extractTasks(input, "k", "m", bad)).rejects.toThrow("500");
  });
});
