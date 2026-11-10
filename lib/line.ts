import { createHmac, timingSafeEqual } from "node:crypto";

/** 驗證 LINE Webhook 簽章：HMAC-SHA256(rawBody, channelSecret) 的 base64 */
export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function replyText(replyToken: string, text: string, accessToken: string): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) console.error("LINE reply failed", res.status, await res.text());
}

export interface LineEvent {
  type: string;
  webhookEventId?: string;
  replyToken?: string;
  timestamp?: number;
  source?: { type: string; userId?: string };
  message?: { id: string; type: string; text?: string };
}
