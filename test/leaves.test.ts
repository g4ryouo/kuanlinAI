import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getAccessToken } from "../lib/google.js";
import { expandDates, parseAppliedDate, parseLeaves, parseSheetDate } from "../lib/leaves.js";

const TODAY = "2026-11-10";

describe("parseAppliedDate (weekday pins the year)", () => {
  it("derives the year from the weekday", () => {
    expect(parseAppliedDate("2/10(Tu)", TODAY)).toBe("2026-02-10");
    expect(parseAppliedDate("1/26(Mo)", TODAY)).toBe("2026-01-26");
    expect(parseAppliedDate("11/9(Mo)", TODAY)).toBe("2026-11-09");
  });
  it("picks last year when the weekday only fits last year", () => {
    expect(parseAppliedDate("12/31(We)", "2026-01-05")).toBe("2025-12-31");
  });
  it("returns null without a usable weekday", () => {
    expect(parseAppliedDate("2/10", TODAY)).toBeNull();
    expect(parseAppliedDate("", TODAY)).toBeNull();
    expect(parseAppliedDate(undefined, TODAY)).toBeNull();
  });
});

describe("parseSheetDate (fallback window when there is no application date)", () => {
  it("handles the formats seen in the sheet", () => {
    expect(parseSheetDate("11/12", TODAY)).toBe("2026-11-12");
    expect(parseSheetDate("9/20", TODAY)).toBe("2026-09-20");
    expect(parseSheetDate("10/22 8:30", TODAY)).toBe("2026-10-22");
    expect(parseSheetDate("10/30 0:00", TODAY)).toBe("2026-10-30");
  });
  it("crosses the year boundary in both directions", () => {
    expect(parseSheetDate("1/5", "2026-12-20")).toBe("2027-01-05");
    expect(parseSheetDate("12/30", "2027-01-03")).toBe("2026-12-30");
  });
  it("ignores old records instead of pushing them into next year", () => {
    expect(parseSheetDate("3/26", TODAY)).toBeNull();
    expect(parseSheetDate("2/10", TODAY)).toBeNull();
  });
  it("rejects garbage and impossible dates", () => {
    expect(parseSheetDate("簡述", TODAY)).toBeNull();
    expect(parseSheetDate("", TODAY)).toBeNull();
    expect(parseSheetDate("2/30", TODAY)).toBeNull();
    expect(parseSheetDate(undefined, TODAY)).toBeNull();
  });
});

describe("parseLeaves", () => {
  // 欄位：B 姓名、C 類別、D 開始、E 結束；H 審核；J 申請日期
  const rows = [
    ["張欽煌", "事假", "02/10", "02/10"],
    ["王永杰", "事假/病假/特休", "11/20", "11/22"],
    ["王永杰", "特休", "11/25", "11/27"],
    ["楊東翰", "病假", "10/22 8:30", "10/22 17:30"],
    ["王永杰", "特休", "10/30 0:00", "10/30"],
    ["", "事假", "11/11", "11/11"],
  ];
  const status = [["審核通過"], ["待審核"], ["審核通過"], ["審核通過"], ["審核通過"], ["審核通過"]];
  const applied = [["2/5(Th)"], ["11/9(Mo)"], ["11/9(Mo)"], ["10/20(Tu)"], ["10/26(Mo)"], ["11/9(Mo)"]];

  it("keeps approved rows with a name; years come from the application date", () => {
    expect(parseLeaves(rows, status, applied, TODAY)).toEqual([
      { name: "張欽煌", start: "2026-02-10", end: "2026-02-10" }, // 舊紀錄仍是今年二月，不會跑到明年
      { name: "王永杰", start: "2026-11-25", end: "2026-11-27" },
      { name: "楊東翰", start: "2026-10-22", end: "2026-10-22" },
      { name: "王永杰", start: "2026-10-30", end: "2026-10-30" },
    ]);
  });
  it("does not resurrect last year's February leave in January of the next year", () => {
    const r = parseLeaves([["張欽煌", "事假", "02/10", "02/10"]], [["審核通過"]], [["2/5(Th)"]], "2027-01-15");
    expect(r).toEqual([{ name: "張欽煌", start: "2026-02-10", end: "2026-02-10" }]);
  });
  it("rolls into next year when a December application is for January", () => {
    const r = parseLeaves([["A", "特休", "1/5", "1/6"]], [["審核通過"]], [["12/20(Su)"]], "2026-12-21");
    expect(r).toEqual([{ name: "A", start: "2027-01-05", end: "2027-01-06" }]);
    const span = parseLeaves([["A", "特休", "12/30", "1/2"]], [["審核通過"]], [["12/20(Su)"]], "2026-12-21");
    expect(span).toEqual([{ name: "A", start: "2026-12-30", end: "2027-01-02" }]);
  });
  it("treats an end slightly before the start as a single day", () => {
    const r = parseLeaves([["A", "事假", "11/12", "11/11"]], [["審核通過"]], [["11/9(Mo)"]], TODAY);
    expect(r).toEqual([{ name: "A", start: "2026-11-12", end: "2026-11-12" }]);
  });
  it("falls back to the window rule when the application date is missing", () => {
    expect(parseLeaves([["A", "事假", "11/12", "11/12"]], [["審核通過"]], [], TODAY)).toEqual([{ name: "A", start: "2026-11-12", end: "2026-11-12" }]);
    expect(parseLeaves([["A", "事假", "3/26", "3/26"]], [["審核通過"]], [], TODAY)).toEqual([]);
  });
  it("ignores rows without an approved status", () => {
    expect(parseLeaves([["A", "事假", "11/12", "11/12"]], [], [["11/9(Mo)"]], TODAY)).toEqual([]);
  });
  it("expands ranges inclusively and caps runaway ranges", () => {
    expect(expandDates({ name: "A", start: "2026-11-25", end: "2026-11-27" })).toEqual(["2026-11-25", "2026-11-26", "2026-11-27"]);
    expect(expandDates({ name: "A", start: "2026-01-01", end: "2026-12-31" })).toHaveLength(31);
  });
});

describe("getAccessToken", () => {
  it("sends a valid RS256-signed JWT and returns the access token", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const sa = JSON.stringify({ client_email: "bot@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
    let assertion = "";
    const fake = (async (_u: unknown, init: RequestInit) => {
      assertion = new URLSearchParams(init.body as string).get("assertion") ?? "";
      return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
    }) as typeof fetch;
    expect(await getAccessToken(sa, fake)).toBe("tok");

    const [h, c, s] = assertion.split(".");
    const claim = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claim.iss).toBe("bot@proj.iam.gserviceaccount.com");
    expect(claim.scope).toBe("https://www.googleapis.com/auth/spreadsheets.readonly");
    const ok = createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });
});
