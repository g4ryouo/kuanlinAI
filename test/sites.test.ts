import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shapeSites, validateSiteInput, type SiteRow, type SiteTaskRow } from "../lib/sites.js";

const TODAY = "2026-11-10";
const site = (over: Partial<SiteRow> & { id: string; name: string }): SiteRow => ({
  region: null, stage: null, start_date: null, end_date: null, lead_person_id: null, headcount_need: null, deadline: null,
  flexible: true, risks: null, open_issues: null, updated_at: "2026-11-01T00:00:00Z", people: null, ...over,
});
const task = (site_id: string | null, over: Partial<SiteTaskRow> = {}): SiteTaskRow => ({ site_id, status: "to_handle", created_at: "2026-11-01T00:00:00Z", assignments: [], ...over });

describe("shapeSites", () => {
  it("flags sites nobody has touched for more than 30 days (like MOLEX and 杜邦 stuck at 9/8)", () => {
    const [molex] = shapeSites([site({ id: "m", name: "MOLEX", updated_at: "2026-09-08T00:00:00Z" })], [], TODAY);
    expect(molex).toMatchObject({ stale: true, days_idle: 63, last_activity: "2026-09-08" });
  });
  it("counts recent task and assignment activity as 'touched', so an active site is not stale", () => {
    const [s] = shapeSites(
      [site({ id: "a", name: "晶心", updated_at: "2026-09-08T00:00:00Z" })],
      [task("a", { status: "done", created_at: "2026-10-30T00:00:00Z", assignments: [{ work_date: "2026-11-12", created_at: "2026-11-09T08:00:00Z" }] })],
      TODAY,
    );
    expect(s).toMatchObject({ stale: false, last_activity: "2026-11-09", days_idle: 1 });
  });
  it("counts upcoming people-days within 14 days (inclusive) and ignores past and far-future ones", () => {
    const a = (d: string) => ({ work_date: d, created_at: "2026-11-01T00:00:00Z" });
    const [s] = shapeSites([site({ id: "a", name: "晶心" })], [task("a", { assignments: [a("2026-11-09"), a("2026-11-10"), a("2026-11-24"), a("2026-11-25")] })], TODAY);
    expect(s.upcoming_people_days).toBe(2); // 11/10 和 11/24
  });
  it("counts pool tasks (to_handle with no assignment) only", () => {
    const [s] = shapeSites(
      [site({ id: "a", name: "晶心" })],
      [task("a"), task("a"), task("a", { assignments: [{ work_date: "2026-11-12", created_at: "2026-11-01T00:00:00Z" }] }), task("a", { status: "cancelled" }), task("zzz")],
      TODAY,
    );
    expect(s.pool_count).toBe(2);
  });
  it("computes days to the deadline (negative when overdue) and the lead's nickname", () => {
    const cards = shapeSites(
      [site({ id: "a", name: "A", deadline: "2026-11-13", people: { name: "張欽煌", nickname: "飛哥" } }), site({ id: "b", name: "B", deadline: "2026-11-08" })],
      [], TODAY,
    );
    const a = cards.find((c) => c.id === "a")!;
    expect(a).toMatchObject({ days_to_deadline: 3, lead_name: "飛哥" });
    expect(cards.find((c) => c.id === "b")!.days_to_deadline).toBe(-2);
  });
  it("shows the stage label, and ignores a stage value it does not know", () => {
    const cards = shapeSites([site({ id: "a", name: "A", stage: "construction" }), site({ id: "b", name: "B", stage: "weird" })], [], TODAY);
    expect(cards.find((c) => c.id === "a")).toMatchObject({ stage: "construction", stage_label: "施工" });
    expect(cards.find((c) => c.id === "b")).toMatchObject({ stage: null, stage_label: null });
  });
  it("lists sites with upcoming work first, then stale ones, then by name", () => {
    const cards = shapeSites(
      [site({ id: "1", name: "丙" }), site({ id: "2", name: "乙", updated_at: "2026-08-01T00:00:00Z" }), site({ id: "3", name: "甲" })],
      [task("3", { assignments: [{ work_date: "2026-11-11", created_at: "2026-11-09T00:00:00Z" }] })],
      TODAY,
    );
    expect(cards.map((c) => c.name)).toEqual(["甲", "乙", "丙"]);
  });
});

const L = "11111111-2222-3333-4444-555555555555";
describe("validateSiteInput", () => {
  it("requires a name when creating but not when updating", () => {
    expect(validateSiteInput({}, true)).toEqual({ ok: false, error: "請填案場名稱" });
    expect(validateSiteInput({ name: "  " }, true).ok).toBe(false);
    expect(validateSiteInput({}, false).ok).toBe(true);
  });
  it("trims text, turns empty strings into null, and keeps valid values", () => {
    const r = validateSiteInput({ name: " 晶心 ", region: " 桃園 ", stage: "construction", start_date: "2026-11-01", end_date: "2026-11-30", lead_person_id: L, headcount_need: "", deadline: "2026-11-20", flexible: false, risks: " 缺料 ", open_issues: "" }, true);
    expect(r).toEqual({ ok: true, value: { name: "晶心", region: "桃園", stage: "construction", start_date: "2026-11-01", end_date: "2026-11-30", lead_person_id: L, headcount_need: null, deadline: "2026-11-20", flexible: false, risks: "缺料", open_issues: null } });
  });
  it("rejects impossible or reversed dates and unknown stages / leads", () => {
    expect(validateSiteInput({ name: "A", deadline: "2026-02-30" }, true)).toMatchObject({ ok: false, error: "重要期限日期不對" });
    expect(validateSiteInput({ name: "A", start_date: "2026-11-10", end_date: "2026-11-01" }, true)).toMatchObject({ ok: false, error: "結束日期不能早於開始日期" });
    expect(validateSiteInput({ name: "A", stage: "nope" }, true)).toMatchObject({ ok: false, error: "階段不對" });
    expect(validateSiteInput({ name: "A", lead_person_id: "not-a-uuid" }, true)).toMatchObject({ ok: false });
  });
  it("limits lengths and rejects non-string text", () => {
    expect(validateSiteInput({ name: "名".repeat(41) }, true).ok).toBe(false);
    expect(validateSiteInput({ name: "A", risks: "x".repeat(1001) }, true).ok).toBe(false);
    expect(validateSiteInput({ name: "A", risks: "x".repeat(1000) }, true).ok).toBe(true);
    expect(validateSiteInput({ name: 123 }, true).ok).toBe(false);
  });
  it("defaults flexible to true unless explicitly false, and rejects non-boolean values", () => {
    expect(validateSiteInput({ name: "A" }, true)).toMatchObject({ ok: true, value: { flexible: true } });
    expect(validateSiteInput({ name: "A", flexible: "no" }, true).ok).toBe(false);
  });
  it("never lets a client set updated_at or other columns", () => {
    const r = validateSiteInput({ name: "A", updated_at: "2000-01-01", id: "x", evil: 1 }, true);
    expect(r.ok && Object.keys(r.value).sort()).toEqual(["deadline", "end_date", "flexible", "headcount_need", "lead_person_id", "name", "open_issues", "region", "risks", "stage", "start_date"]);
  });
});

describe("the sites page", () => {
  const html = readFileSync(new URL("../liff/sites.html", import.meta.url), "utf8");
  it("never writes API data with innerHTML", () => {
    expect(html).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
  });
  it("authenticates with the ID token and uses the sites APIs", () => {
    expect(html).toContain("liff.getIDToken()");
    expect(html).toContain("/api/liff/sites");
    expect(html).toContain("/api/liff/site-save");
  });
  it("labels every form field and announces errors", () => {
    for (const id of ["fName", "fRegion", "fStage", "fStart", "fEnd", "fLead", "fHc", "fDeadline", "fRisks", "fIssues"]) expect(html).toContain(`'${id}'`);
    expect(html).toContain("l.htmlFor = id");
    expect(html).toContain("setAttribute('role', 'alert')");
    expect(html).toContain('role="dialog"');
    expect(html).toContain("min-height:44px");
  });
  it("shows the stale warning in words", () => {
    expect(html).toContain("天沒更新");
  });
});
