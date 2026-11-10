import { describe, expect, it } from "vitest";
import { applyAutoRules, blockTexts, evaluateItems, hasBlock, type RuleContext } from "../lib/rules.js";
import { confirmCard } from "../lib/flex.js";
import type { DraftItem } from "../lib/types.js";

const P = (id: string, name: string, constraints: Record<string, unknown> = {}, active = true) => [id, { id, name, active, constraints }] as const;
const people = new Map([
  P("fei", "張欽煌"),
  P("lun", "莊岳倫"),
  P("dong", "楊東翰"),
  P("jie", "王永杰", { avoid_weekend: true }),
  P("sheng", "李弘盛", { no_solo: true }),
  P("ze", "阿澤", { solo_low_voltage: true }),
  P("zhen", "阿鎮", { team_size: 4 }),
  P("guo", "阿國", { cancelled: true }, false),
]);
const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({
  people, leaves: new Set(), existing: [], defaultWaterTeamId: "zhen", ...over,
});
const item = (over: Partial<DraftItem> = {}): DraftItem => ({
  site: "晶心", work: "施工", date: "2026-11-11", time_slot: null, people: [], vehicle: null, headcount: null,
  priority: "normal", fixed: false, uncertain: [], person_ids: [], person_names: [], unknown_people: [], ...over,
});
const texts = (it: DraftItem, c = ctx()) => evaluateItems([it], c)[0].map((i) => `${i.level}:${i.text}`);

describe("auto rules", () => {
  it("excludes people on leave and says so", () => {
    const [r] = applyAutoRules([item({ person_ids: ["fei", "dong"], person_names: ["張欽煌", "楊東翰"] })], ctx({ leaves: new Set(["dong|2026-11-11"]) }));
    expect(r.person_ids).toEqual(["fei"]);
    expect(r.excluded).toEqual(["楊東翰 11/11 請假，已排除"]);
  });
  it("excludes people who ended the partnership (阿國)", () => {
    const [r] = applyAutoRules([item({ person_ids: ["guo"], person_names: ["阿國"] })], ctx());
    expect(r.person_ids).toEqual([]);
    expect(r.excluded?.[0]).toContain("已取消合作");
  });
  it("defaults water/electrical work with no people to 阿鎮", () => {
    const [r] = applyAutoRules([item({ work: "給排水管線施工" })], ctx());
    expect(r.person_ids).toEqual(["zhen"]);
    expect(r.auto_note).toContain("預設排給阿鎮");
  });
  it("does not default when someone was named, or when it is low voltage", () => {
    expect(applyAutoRules([item({ work: "水電", person_ids: ["fei"], person_names: ["張欽煌"] })], ctx())[0].person_ids).toEqual(["fei"]);
    expect(applyAutoRules([item({ work: "弱電施工" })], ctx())[0].person_ids).toEqual([]);
  });
  it("does not default to 阿鎮 when he is on leave", () => {
    expect(applyAutoRules([item({ work: "水電" })], ctx({ leaves: new Set(["zhen|2026-11-11"]) }))[0].person_ids).toEqual([]);
  });
});

describe("warnings", () => {
  it("warns on a single person for construction/repair", () => {
    expect(texts(item({ person_ids: ["fei"] }))[0]).toContain("至少 2 人");
  });
  it("says 阿盛 cannot go alone unless it is a delivery", () => {
    expect(texts(item({ person_ids: ["sheng"] }))[0]).toContain("不可單獨出勤");
    expect(texts(item({ person_ids: ["sheng"], work: "送貨到晶心" }))).toEqual([]);
    expect(texts(item({ person_ids: ["sheng", "fei"] }))).toEqual([]);
  });
  it("lets 阿澤 go alone for low voltage, and teams never trigger it", () => {
    expect(texts(item({ person_ids: ["ze"], work: "弱電維修" }))).toEqual([]);
    expect(texts(item({ person_ids: ["ze"], work: "水管維修" }))[0]).toContain("至少 2 人");
    expect(texts(item({ person_ids: ["zhen"], work: "水電" }))).toEqual([]);
  });
  it("warns when 阿杰 is scheduled on a weekend", () => {
    expect(texts(item({ person_ids: ["jie", "fei"], date: "2026-11-14" }))).toEqual(["warn:王永杰 假日原則不排"]);
    expect(texts(item({ person_ids: ["jie", "fei"], date: "2026-11-11" }))).toEqual([]);
  });
});

describe("hourly overlap", () => {
  const ex = { person_id: "fei", work_date: "2026-11-11", start_time: "09:00:00", end_time: "12:00:00", label: "杜邦 施工" };
  it("blocks overlapping hours with an existing assignment", () => {
    const c = ctx({ existing: [ex] });
    const all = evaluateItems([item({ person_ids: ["fei", "lun"], start_time: "11:00", end_time: "13:00" })], c);
    expect(hasBlock(all)).toBe(true);
    expect(blockTexts(all)[0]).toContain("杜邦 施工");
  });
  it("allows back-to-back and different days", () => {
    const c = ctx({ existing: [ex] });
    expect(hasBlock(evaluateItems([item({ person_ids: ["fei", "lun"], start_time: "12:00", end_time: "15:00" })], c))).toBe(false);
    expect(hasBlock(evaluateItems([item({ person_ids: ["fei", "lun"], date: "2026-11-12", start_time: "09:00", end_time: "12:00" })], c))).toBe(false);
  });
  it("does not check when there is no hourly time", () => {
    expect(hasBlock(evaluateItems([item({ person_ids: ["fei", "lun"] })], ctx({ existing: [ex] })))).toBe(false);
  });
  it("blocks overlap between two items of the same draft", () => {
    const a = item({ person_ids: ["fei", "lun"], start_time: "09:00", end_time: "11:00" });
    const b = item({ site: "杜邦", person_ids: ["fei", "dong"], start_time: "10:00", end_time: "12:00" });
    const all = evaluateItems([a, b], ctx());
    expect(hasBlock([all[0]])).toBe(false);
    expect(hasBlock([all[1]])).toBe(true);
  });
});

describe("card", () => {
  it("renders info, warn and block rows", () => {
    const it = item({ person_ids: ["fei"], excluded: ["楊東翰 11/11 請假，已排除"] });
    const card = JSON.stringify(confirmCard("D1", [it], [], evaluateItems([it], ctx())));
    expect(card).toContain("請假，已排除");
    expect(card).toContain("至少 2 人");
  });
});
