import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { moveFollowup, saveFollowup } from "../lib/followupActions.js";
import { canMove, shapeFollowups, validateFollowInput, type FollowRow } from "../lib/followups.js";

const TODAY = "2026-11-10";
const row = (over: Partial<FollowRow> & { id: string }): FollowRow => ({
  title: "回覆內湖店", status: "to_reply", priority: "normal", contact: null, note: null, due_date: null, waiting_since: null,
  created_at: "2026-11-08T00:00:00Z", completed_at: null, site_id: null, sites: null, ...over,
});

describe("shapeFollowups", () => {
  it("splits items into the three live sections and keeps only recently finished ones", () => {
    const v = shapeFollowups(
      [
        row({ id: "1" }),
        row({ id: "2", status: "waiting_other", waiting_since: "2026-11-05T00:00:00Z" }),
        row({ id: "3", status: "flexible_hold" }),
        row({ id: "4", status: "done", completed_at: "2026-11-09T00:00:00Z" }),
        row({ id: "5", status: "done", completed_at: "2026-10-01T00:00:00Z" }), // 太久以前
        row({ id: "6", status: "cancelled" }),
        row({ id: "7", status: "to_handle" }), // 排班任務不是追蹤事項
      ],
      TODAY,
    );
    expect(v.to_reply.map((i) => i.id)).toEqual(["1"]);
    expect(v.waiting_other.map((i) => i.id)).toEqual(["2"]);
    expect(v.flexible_hold.map((i) => i.id)).toEqual(["3"]);
    expect(v.done.map((i) => i.id)).toEqual(["4"]);
  });
  it("shows how many days we have been waiting and warns after 3 days", () => {
    const v = shapeFollowups(
      [row({ id: "a", status: "waiting_other", waiting_since: "2026-11-05T08:00:00Z" }), row({ id: "b", status: "waiting_other", waiting_since: "2026-11-09T08:00:00Z" })],
      TODAY,
    );
    const a = v.waiting_other.find((i) => i.id === "a")!;
    const b = v.waiting_other.find((i) => i.id === "b")!;
    expect(a).toMatchObject({ waiting_days: 5, wait_warn: true });
    expect(b).toMatchObject({ waiting_days: 1, wait_warn: false });
    expect(shapeFollowups([row({ id: "x" })], TODAY).to_reply[0].waiting_days).toBeNull();
  });
  it("marks overdue items and counts days to the due date", () => {
    const v = shapeFollowups([row({ id: "late", due_date: "2026-11-08" }), row({ id: "soon", due_date: "2026-11-12" }), row({ id: "none" })], TODAY);
    expect(v.to_reply.find((i) => i.id === "late")).toMatchObject({ overdue: true, days_to_due: -2 });
    expect(v.to_reply.find((i) => i.id === "soon")).toMatchObject({ overdue: false, days_to_due: 2 });
  });
  it("sorts overdue first, then urgent, then nearest due date, then oldest", () => {
    const v = shapeFollowups(
      [
        row({ id: "plain", created_at: "2026-11-09T00:00:00Z" }),
        row({ id: "urgent", priority: "high", created_at: "2026-11-09T00:00:00Z" }),
        row({ id: "overdue", due_date: "2026-11-01" }),
        row({ id: "dueSoon", due_date: "2026-11-11" }),
        row({ id: "older", created_at: "2026-10-20T00:00:00Z" }),
      ],
      TODAY,
    );
    expect(v.to_reply.map((i) => i.id)).toEqual(["overdue", "urgent", "dueSoon", "older", "plain"]);
  });
  it("carries the site name", () => {
    expect(shapeFollowups([row({ id: "s", site_id: "x", sites: { name: "晶心" } })], TODAY).to_reply[0].site).toBe("晶心");
  });
});

describe("canMove", () => {
  it("moves between the three sections, or to done / cancelled", () => {
    expect(canMove("to_reply", "waiting_other")).toBe(true);
    expect(canMove("waiting_other", "to_reply")).toBe(true);
    expect(canMove("flexible_hold", "done")).toBe(true);
    expect(canMove("to_reply", "cancelled")).toBe(true);
  });
  it("lets a finished item be reopened as 待我回覆 only", () => {
    expect(canMove("done", "to_reply")).toBe(true);
    expect(canMove("done", "waiting_other")).toBe(false);
    expect(canMove("done", "cancelled")).toBe(false);
  });
  it("refuses no-ops, scheduling statuses and unknown values", () => {
    expect(canMove("to_reply", "to_reply")).toBe(false);
    expect(canMove("to_handle", "done")).toBe(false);
    expect(canMove("cancelled", "to_reply")).toBe(false);
    expect(canMove("to_reply", "to_handle")).toBe(false);
    expect(canMove("to_reply", "weird")).toBe(false);
  });
});

const SITE = "11111111-2222-3333-4444-555555555555";
describe("validateFollowInput", () => {
  it("needs a title and, when creating, a valid status", () => {
    expect(validateFollowInput({ status: "to_reply" }, true)).toEqual({ ok: false, error: "請填這件事是什麼" });
    expect(validateFollowInput({ title: "x" }, true)).toEqual({ ok: false, error: "請選擇狀態" });
    expect(validateFollowInput({ title: "x", status: "to_handle" }, true).ok).toBe(false);
    expect(validateFollowInput({ title: "x" }, false).ok).toBe(true); // 修改時不能改狀態，所以不需要
  });
  it("trims, nulls empties, maps the urgent flag and keeps valid values", () => {
    expect(validateFollowInput({ title: " 回覆 ", status: "waiting_other", contact: " 王經理 ", note: "", site_id: SITE, due_date: "2026-11-20", urgent: true }, true)).toEqual({
      ok: true,
      value: { title: "回覆", status: "waiting_other", contact: "王經理", note: null, site_id: SITE, due_date: "2026-11-20", priority: "high" },
    });
  });
  it("rejects bad dates, site ids, long text and wrong types", () => {
    expect(validateFollowInput({ title: "x", status: "to_reply", due_date: "2026-02-30" }, true)).toMatchObject({ ok: false, error: "期限日期不對" });
    expect(validateFollowInput({ title: "x", status: "to_reply", site_id: "nope" }, true).ok).toBe(false);
    expect(validateFollowInput({ title: "字".repeat(81), status: "to_reply" }, true).ok).toBe(false);
    expect(validateFollowInput({ title: "x", status: "to_reply", note: "n".repeat(501) }, true).ok).toBe(false);
    expect(validateFollowInput({ title: 5, status: "to_reply" }, true).ok).toBe(false);
    expect(validateFollowInput({ title: "x", status: "to_reply", urgent: "yes" }, true).ok).toBe(false);
  });
  it("only ever returns whitelisted fields (a client cannot set completed_at, follow_up, etc.)", () => {
    const r = validateFollowInput({ title: "x", status: "to_reply", completed_at: "2000-01-01", follow_up: false, waiting_since: "x", id: "y" }, true);
    expect(r.ok && Object.keys(r.value).sort()).toEqual(["contact", "due_date", "note", "priority", "site_id", "status", "title"]);
  });
});

describe("actions reject malformed ids before touching the database", () => {
  it("move and update", async () => {
    expect(await moveFollowup("nope", "done", "u")).toMatchObject({ ok: false, status: 400 });
    expect(await saveFollowup({ id: "nope", title: "x" }, "u")).toMatchObject({ ok: false, status: 400 });
    expect(await saveFollowup({ title: "" , status: "to_reply" }, "u")).toMatchObject({ ok: false, status: 400 });
  });
});

describe("the follow-up page and migration", () => {
  const html = readFileSync(new URL("../liff/follow.html", import.meta.url), "utf8");
  it("never writes API data with innerHTML and authenticates with the ID token", () => {
    expect(html).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
    expect(html).toContain("liff.getIDToken()");
    expect(html).toContain("/api/liff/followups");
    expect(html).toContain("/api/liff/followup-save");
    expect(html).toContain("/api/liff/followup-move");
  });
  it("labels form fields, announces errors, confirms before cancelling", () => {
    for (const id of ["fTitle", "fStatus", "fContact", "fSite", "fDue", "fNote"]) expect(html).toContain(`'${id}'`);
    expect(html).toContain("setAttribute('role', 'alert')");
    expect(html).toContain("window.confirm(");
    expect(html).toContain("min-height:44px");
  });
  it("shows the waiting days and has all three sections", () => {
    expect(html).toContain("已等 ");
    for (const s of ["待我回覆", "等對方回覆", "機動待辦"]) expect(html).toContain(s);
  });
  it("the migration adds the follow-up columns", () => {
    const sql = readFileSync(new URL("../supabase/migrations/0011_followups.sql", import.meta.url), "utf8");
    for (const c of ["follow_up", "contact", "note", "due_date", "completed_at"]) expect(sql).toContain(c);
  });
});
