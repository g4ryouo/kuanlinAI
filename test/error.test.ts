import { describe, expect, it } from "vitest";
import { shortError } from "../lib/errors.js";

describe("shortError", () => {
  it("redacts keys and truncates", () => {
    const msg = shortError(new Error("Anthropic API 401: invalid x-api-key sk-ant-usr-1-AAAA Bearer abc123 " + "x".repeat(400)));
    expect(msg).not.toContain("AAAA");
    expect(msg).not.toContain("abc123");
    expect(msg).toContain("Anthropic API 401");
    expect(msg.length).toBeLessThanOrEqual(180);
  });
  it("handles non-Error values such as Supabase error objects", () => {
    expect(shortError({ message: "relation \"drafts\" does not exist" })).toContain("drafts");
  });
});
