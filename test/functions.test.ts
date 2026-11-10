import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROUTES, dispatch, routeName } from "../lib/liffRouter.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const listFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });

describe("Vercel Hobby plan limit: at most 12 serverless functions per deployment", () => {
  const functions = listFiles(join(root, "api")).filter((f) => /\.(ts|js|mjs)$/.test(f));
  it("keeps the number of files under api/ well below the limit", () => {
    expect(functions.length, functions.join(", ")).toBeLessThanOrEqual(8); // 上限 12，留餘裕
  });
  it("serves every LIFF endpoint from a single function", () => {
    expect(functions.filter((f) => f.includes(`${join("api", "liff")}`))).toHaveLength(1);
  });
});

describe("LIFF routing", () => {
  it("every /api/liff/<name> the pages call is registered", () => {
    const used = new Set<string>();
    for (const f of listFiles(join(root, "liff")).filter((p) => p.endsWith(".html"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/\/api\/liff\/([a-z-]+)/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(8);
    for (const name of used) expect(Object.keys(ROUTES), name).toContain(name);
  });
  it("vercel.json rewrites /api/liff/:route to the single function and keeps the page rewrites", () => {
    const v = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
    expect(v.rewrites).toContainEqual({ source: "/api/liff/:route", destination: "/api/liff?route=:route" });
    expect(v.rewrites).toContainEqual({ source: "/liff/:page", destination: "/liff/:page.html" });
  });
  it("picks the route from the rewrite query, or from the last path segment as a fallback", () => {
    expect(routeName(new Request("http://x/api/liff?route=today&date=2026-11-10"))).toBe("today");
    expect(routeName(new Request("http://x/api/liff/board?view=month"))).toBe("board");
  });
  it("answers 404 for unknown routes (including prototype-chain names) and 405 for the wrong method", async () => {
    expect((await dispatch("GET", new Request("http://x/api/liff?route=nope"))).status).toBe(404);
    expect((await dispatch("GET", new Request("http://x/api/liff?route=constructor"))).status).toBe(404);
    expect((await dispatch("GET", new Request("http://x/api/liff?route=toString"))).status).toBe(404);
    expect((await dispatch("POST", new Request("http://x/api/liff?route=today", { method: "POST", body: "{}" }))).status).toBe(405);
    expect((await dispatch("GET", new Request("http://x/api/liff?route=pool-assign"))).status).toBe(405);
  });
  it("still enforces login: every protected route is 401 without a token", async () => {
    for (const [name, mod] of Object.entries(ROUTES)) {
      if (name === "config") continue; // 公開設定（LIFF ID 不是機密）
      const method = mod.POST ? "POST" : "GET";
      const res = await dispatch(method, new Request(`http://x/api/liff?route=${name}`, { method, body: method === "POST" ? "{}" : undefined }));
      expect(res.status, name).toBe(401);
    }
  });
  it("the public config route works without login", async () => {
    expect((await dispatch("GET", new Request("http://x/api/liff?route=config"))).status).toBe(200);
  });
});
