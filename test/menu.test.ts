import { describe, expect, it } from "vitest";
import { menuReply } from "../lib/menu.js";

describe("menuReply", () => {
  it("answers the two live commands with usable text", () => {
    expect(menuReply("新增任務")).toContain("轉傳");
    const help = menuReply("怎麼用")!;
    expect(help).toContain("確認新增");
    expect(help).toContain("同步請假");
    expect(help).toContain("語音");
  });
  it("says the four web screens are not ready yet", () => {
    for (const k of ["今日工作", "待我回覆", "人力排班", "專案總覽"]) expect(menuReply(k)).toContain("建置中");
  });
  it("ignores surrounding whitespace but never matches inside real messages", () => {
    expect(menuReply("  怎麼用 ")).not.toBeNull();
    expect(menuReply("明天今日工作要去晶心")).toBeNull();
    expect(menuReply("新增任務：晶心裝設備")).toBeNull();
    expect(menuReply(undefined)).toBeNull();
    expect(menuReply("constructor")).toBeNull();
  });
  it("does not mention features that do not exist yet", () => {
    const help = menuReply("怎麼用")!;
    for (const bad of ["看這週誰還沒排", "缺幾個人？", "改派到廣明"]) expect(help).not.toContain(bad);
  });
});
