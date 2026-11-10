import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { authorize, verifyIdToken } from "../lib/liffAuth.js";
import { shapeToday, weekdayOf, type AssignmentRow } from "../lib/today.js";

const req = (auth?: string) => new Request("http://x/api", { headers: auth ? { authorization: auth } : {} });
const okVerify = (sub: string) =>
  (async () => new Response(JSON.stringify({ sub, name: "冠旭" }), { status: 200 })) as unknown as typeof fetch;

describe("liff auth", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.LINE_LOGIN_CHANNEL_ID = "2012529109";
    process.env.ALLOWED_LINE_USER_IDS = "Uboss, Ugary";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("rejects requests without a bearer token", async () => {
    expect(await authorize(req())).toMatchObject({ ok: false, status: 401 });
  });
  it("rejects when LINE says the token is invalid", async () => {
    const bad = (async () => new Response("no", { status: 400 })) as typeof fetch;
    expect(await authorize(req("Bearer x"), bad)).toMatchObject({ ok: false, status: 401 });
  });
  it("rejects valid LINE users who are not on the allowlist", async () => {
    expect(await authorize(req("Bearer x"), okVerify("Ustranger"))).toMatchObject({ ok: false, status: 403 });
  });
  it("accepts allowlisted users (list is comma separated, spaces tolerated)", async () => {
    expect(await authorize(req("Bearer x"), okVerify("Ugary"))).toMatchObject({ ok: true, userId: "Ugary" });
    expect(await authorize(req("Bearer x"), okVerify("Uboss"))).toMatchObject({ ok: true });
  });
  it("sends the id token and our channel id to LINE", async () => {
    let body = "";
    const spy = (async (_u: unknown, init: RequestInit) => {
      body = String(init.body);
      return new Response(JSON.stringify({ sub: "Uboss" }), { status: 200 });
    }) as unknown as typeof fetch;
    await verifyIdToken("tok123", "2012529109", spy);
    expect(body).toContain("id_token=tok123");
    expect(body).toContain("client_id=2012529109");
  });
  it("fails closed when the channel id is not configured", async () => {
    delete process.env.LINE_LOGIN_CHANNEL_ID;
    expect(await authorize(req("Bearer x"), okVerify("Ugary"))).toMatchObject({ ok: false, status: 500 });
  });
});

const row = (over: Partial<AssignmentRow> & { who: string }): AssignmentRow => ({
  task_id: "t1", work_date: "2026-11-11", start_time: "09:00:00", end_time: "12:00:00", kind: "S",
  people: { name: over.who }, vehicles: null, tasks: { title: "晶心 裝監視器", sites: { name: "晶心" } }, ...over,
});

describe("shapeToday", () => {
  it("merges people on the same job and time into one card, sorted by time", () => {
    const v = shapeToday("2026-11-11", [
      row({ who: "張欽煌" }),
      row({ who: "莊岳倫" }),
      row({ who: "王永杰", task_id: "t2", start_time: "08:00:00", end_time: "10:00:00", tasks: { title: "杜邦 巡檢", sites: { name: "杜邦" } }, kind: "V" }),
    ], []);
    expect(v.weekday).toBe("三");
    expect(v.groups.map((g) => g.title)).toEqual(["杜邦 巡檢", "晶心 裝監視器"]);
    expect(v.groups[1].people).toEqual(["張欽煌", "莊岳倫"]);
    expect(v.groups[1].start).toBe("09:00");
    expect(v.groups[0].kind_label).toBe("場勘／會議");
  });
  it("splits the same job when the vehicle or time differs, and puts untimed jobs last", () => {
    const v = shapeToday("2026-11-11", [
      row({ who: "A", vehicles: { name: "ZINGER" } }),
      row({ who: "B", vehicles: { name: "WISH" } }),
      row({ who: "C", task_id: "t9", start_time: null, end_time: null, tasks: { title: "待排工作", sites: null } }),
    ], []);
    expect(v.groups).toHaveLength(3);
    expect(v.groups[2].title).toBe("待排工作");
    expect(v.groups[2].start).toBeNull();
  });
  it("lists leave names once and handles an empty day", () => {
    const v = shapeToday("2026-11-12", [], ["楊東翰", "楊東翰"]);
    expect(v.groups).toEqual([]);
    expect(v.leaves).toEqual(["楊東翰"]);
  });
  it("computes the weekday", () => {
    expect(weekdayOf("2026-11-10")).toBe("二");
    expect(weekdayOf("2026-11-14")).toBe("六");
  });
});

describe("the today page", () => {
  const html = readFileSync(new URL("../liff/today.html", import.meta.url), "utf8");
  it("never writes API data with innerHTML", () => {
    expect(html).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
  });
  it("sends the ID token and calls the today API", () => {
    expect(html).toContain("liff.getIDToken()");
    expect(html).toContain("/api/liff/today");
    expect(html).toContain("Authorization");
  });
  it("has accessible, tappable navigation buttons", () => {
    for (const label of ["前一天", "後一天", "回到今天"]) expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain("min-height:44px");
  });
});
