import { describe, expect, it } from "vitest";
import { VEHICLE_OPTIONS, normalizeVehicle, timeText } from "../lib/draft.js";
import { confirmCard, parsePostback, vehicleQuickReply } from "../lib/flex.js";
import { parseServiceAccount } from "../lib/google.js";
import { evaluateItems, hasBlock, type RuleContext } from "../lib/rules.js";
import type { DraftItem } from "../lib/types.js";

const P = (id: string, name: string, constraints: Record<string, unknown> = {}) => [id, { id, name, active: true, constraints }] as const;
const people = new Map([P("boss", "陳冠璋"), P("fei", "張欽煌"), P("lun", "莊岳倫"), P("sheng", "李弘盛", { no_solo: true })]);
const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({ people, leaves: new Set(), existing: [], ...over });
const item = (over: Partial<DraftItem> = {}): DraftItem => ({
  site: "晶心", work: "施工", date: "2026-11-11", time_slot: null, people: [], vehicle: null, headcount: null,
  priority: "normal", fixed: false, uncertain: [], person_ids: ["fei", "lun"], person_names: ["張欽煌", "莊岳倫"], unknown_people: [], ...over,
});
const lines = (it: DraftItem, c = ctx()) => evaluateItems([it], c)[0].map((i) => `${i.level}:${i.text}`);

describe("vehicles", () => {
  it("normalizes AI vehicle text", () => {
    expect(normalizeVehicle("CRV")).toBe("CR-V");
    expect(normalizeVehicle("cr-v")).toBe("CR-V");
    expect(normalizeVehicle("zinger 小貨車")).toBe("ZINGER");
    expect(normalizeVehicle("Wish")).toBe("WISH");
    expect(normalizeVehicle("公司的車")).toBeNull();
    expect(normalizeVehicle(null)).toBeNull();
  });
  it("CR-V is the boss's car: others get a warning pointing at the special option", () => {
    expect(lines(item({ vehicle: "CR-V" }))).toEqual(["warn:CR-V 以冠璋為主；其他人使用請改選「CR-V（特例）」"]);
    expect(lines(item({ vehicle: "CR-V", person_ids: ["boss", "fei"] }))).toEqual([]);
  });
  it("the special option warns that the boss must agree, and shows on the card", () => {
    const it = item({ vehicle: "CR-V", vehicle_special: true });
    expect(lines(it)).toEqual(["warn:CR-V 特例使用，需冠璋同意"]);
    expect(JSON.stringify(confirmCard("D1", [it]))).toContain("CR-V（特例，需冠璋同意）");
  });
  it("blocks the same vehicle at overlapping hours (existing and within the draft)", () => {
    const existing = [{ person_id: "x", work_date: "2026-11-11", start_time: "09:00:00", end_time: "12:00:00", label: "杜邦 施工", vehicle: "ZINGER" }];
    expect(hasBlock(evaluateItems([item({ vehicle: "ZINGER", start_time: "11:00", end_time: "13:00" })], ctx({ existing })))).toBe(true);
    expect(hasBlock(evaluateItems([item({ vehicle: "WISH", start_time: "11:00", end_time: "13:00" })], ctx({ existing })))).toBe(false);
    expect(hasBlock(evaluateItems([item({ vehicle: "ZINGER", start_time: "12:00", end_time: "13:00" })], ctx({ existing })))).toBe(false);
    const a = item({ vehicle: "WISH", start_time: "09:00", end_time: "11:00" });
    const b = item({ site: "杜邦", vehicle: "WISH", person_ids: ["boss"], start_time: "10:00", end_time: "12:00" });
    expect(hasBlock([evaluateItems([a, b], ctx())[1]])).toBe(true);
  });
  it("does not check vehicle overlap without hourly times", () => {
    const existing = [{ person_id: "x", work_date: "2026-11-11", start_time: null, end_time: null, label: "杜邦 施工", vehicle: "ZINGER" }];
    expect(hasBlock(evaluateItems([item({ vehicle: "ZINGER" })], ctx({ existing })))).toBe(false);
  });
  it("has a vehicle button", () => {
    expect(JSON.stringify(confirmCard("D1", [item()]))).toContain("a=vehicle&d=D1");
    expect(parsePostback("a=veh&d=D1&v=s")).toMatchObject({ a: "veh", v: "s" });
  });
  it("offers plain CR-V only when the boss is assigned; everyone else only gets the special option", () => {
    const labels = (boss: boolean) => (vehicleQuickReply("D1", boss) as any).quickReply.items.map((i: any) => i.action.label);
    expect(labels(true)).toEqual(["ZINGER", "WISH", "CR-V", "不指定車輛"]);
    expect(labels(false)).toEqual(["ZINGER", "WISH", "CR-V（特例）", "不指定車輛"]);
    for (const o of VEHICLE_OPTIONS) expect(JSON.stringify(vehicleQuickReply("D1", true)) + JSON.stringify(vehicleQuickReply("D1", false))).toContain(`v=${o.code}`);
  });
});

describe("time display", () => {
  it("shows the full range, start only, or the slot", () => {
    expect(timeText(item({ start_time: "11:00", end_time: "14:00" }))).toBe("2026-11-11 11:00–14:00");
    expect(timeText(item({ start_time: "11:00" }))).toBe("2026-11-11 11:00 起");
    expect(timeText(item({ time_slot: "上午" }))).toBe("2026-11-11 上午");
    expect(timeText(item({ date: null }))).toBe("日期待確認");
  });
});

describe("merged headcount / minimum-two warning", () => {
  it("shows only the headcount reminder when an estimate exists", () => {
    const one = item({ person_ids: ["fei"], person_names: ["張欽煌"], headcount: 2 });
    expect(lines(one)).toEqual([]); // 「預估 2 人但指派 1 人」由卡片上的那一行顯示，不再多一條
    const card = JSON.stringify(confirmCard("D1", [one], [], evaluateItems([one], ctx())));
    expect(card).toContain("原先預估 2 人，但指派了 1 人");
    expect(card).not.toContain("建議至少 2 人");
  });
  it("still shows the generic minimum-two warning without an estimate, and 阿盛's specific one always", () => {
    expect(lines(item({ person_ids: ["fei"], headcount: null }))[0]).toContain("建議至少 2 人");
    expect(lines(item({ person_ids: ["sheng"], headcount: 2 }))[0]).toContain("不可單獨出勤");
  });
});

describe("friendly service-account errors", () => {
  const good = { type: "service_account", client_email: "a@b.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n" };
  it("accepts raw JSON, a quoted string, and base64", () => {
    const raw = JSON.stringify(good);
    expect(parseServiceAccount(raw).client_email).toBe(good.client_email);
    expect(parseServiceAccount(JSON.stringify(raw)).client_email).toBe(good.client_email);
    expect(parseServiceAccount(Buffer.from(raw).toString("base64")).client_email).toBe(good.client_email);
  });
  it("turns escaped newlines in the private key into real newlines", () => {
    const sa = parseServiceAccount(JSON.stringify({ ...good, private_key: "line1\\nline2" }));
    expect(sa.private_key).toBe("line1\nline2");
  });
  it("explains common mistakes in plain language", () => {
    expect(() => parseServiceAccount("")).toThrow("是空的");
    expect(() => parseServiceAccount("not json at all {")).toThrow("不是有效的 JSON");
    expect(() => parseServiceAccount(JSON.stringify({ web: { client_id: "x", client_secret: "y" } }))).toThrow("OAuth");
    expect(() => parseServiceAccount(JSON.stringify({ type: "service_account", client_email: "a@b" }))).toThrow("缺少");
  });
});
