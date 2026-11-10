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

export type LineMessage = Record<string, unknown>;

/** 主動推播給某位使用者（會消耗官方帳號每月的推播則數） */
export async function pushMessages(to: string, messages: LineMessage[], accessToken: string): Promise<{ ok: boolean; status: number; detail?: string }> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ to, messages }),
  });
  return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, detail: (await res.text()).slice(0, 200) };
}

export async function replyMessages(replyToken: string, messages: LineMessage[], accessToken: string): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) console.error("LINE reply failed", res.status, await res.text());
}

/** 下載使用者傳來的圖片，回傳 base64 與格式 */
export async function getImageContent(
  messageId: string,
  accessToken: string,
): Promise<{ mediaType: string; base64: string; bytes: number }> {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`LINE content ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mediaType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  return { mediaType, base64: buf.toString("base64"), bytes: buf.length };
}

/** 下載使用者傳來的語音（LINE 語音是 m4a） */
export async function getAudioContent(messageId: string, accessToken: string): Promise<{ audio: Buffer; bytes: number }> {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`LINE content ${res.status}`);
  const audio = Buffer.from(await res.arrayBuffer());
  return { audio, bytes: audio.length };
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
  message?: { id: string; type: string; text?: string; duration?: number };
  postback?: { data: string };
}
