import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("阿國 is gone", () => {
  it("is not referenced by any live code or page", () => {
    const files = [
      ...readdirSync(new URL("../lib/", import.meta.url)).map((f) => `../lib/${f}`),
      ...readdirSync(new URL("../api/liff/", import.meta.url)).map((f) => `../api/liff/${f}`),
      "../api/line/webhook.ts", "../liff/board.html", "../liff/today.html", "../line-prototype.html", "../month-board.html",
    ];
    for (const f of files) expect(read(f), f).not.toContain("阿國");
  });
  it("the board-order migration no longer touches him, and a cleanup migration removes his alias and row safely", () => {
    expect(read("../supabase/migrations/0006_board_order.sql")).not.toContain("阿國");
    const sql = read("../supabase/migrations/0009_remove_guo.sql");
    expect(sql).toContain("delete from aliases");
    expect(sql).toMatch(/not exists \(select 1 from assignments/);
    expect(sql).toMatch(/not exists \(select 1 from leaves/);
    expect(sql).toMatch(/update people set active = false where name = '阿國'/);
  });
});

describe("leave (假) has its own color", () => {
  const html = read("../liff/board.html");
  it("is teal in light and dark mode, no longer the same gray as 未叫工", () => {
    expect(html).toContain(".k-L{background:#CDEFF2;color:#0B6470}");
    expect(html).toContain(".k-L{background:#12414A;color:#A6E3EA}");
    expect(html).toMatch(/\.k-N\{background:#F0F1EF/);
    expect(html).not.toContain(".k-L{background:#E3E5E4");
  });
});
