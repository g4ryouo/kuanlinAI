import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "../lib/line";

const secret = "test-secret";
const body = JSON.stringify({ events: [] });
const sig = createHmac("sha256", secret).update(body).digest("base64");

describe("verifySignature", () => {
  it("accepts a valid signature", () => expect(verifySignature(body, sig, secret)).toBe(true));
  it("rejects a tampered body", () => expect(verifySignature(body + " ", sig, secret)).toBe(false));
  it("rejects a wrong secret", () => expect(verifySignature(body, sig, "other")).toBe(false));
  it("rejects missing signature or secret", () => {
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, sig, "")).toBe(false);
  });
});
