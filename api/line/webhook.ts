import { allowedUserIds, env } from "../../lib/env.js";
import { db } from "../../lib/db.js";
import { replyText, verifySignature, type LineEvent } from "../../lib/line.js";

export async function GET(): Promise<Response> {
  return new Response("ok");
}

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();

  // 1. 簽章驗證：不過就直接丟棄
  if (!verifySignature(raw, request.headers.get("x-line-signature"), env("LINE_CHANNEL_SECRET"))) {
    return new Response("invalid signature", { status: 401 });
  }

  let events: LineEvent[] = [];
  try {
    events = (JSON.parse(raw).events ?? []) as LineEvent[];
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const allowed = allowedUserIds();
  const bootstrap = env("BOOTSTRAP_MODE") === "true";
  const token = env("LINE_CHANNEL_ACCESS_TOKEN");

  for (const ev of events) {
    const userId = ev.source?.userId ?? null;
    const isAllowed = !!userId && allowed.has(userId);

    // 2. 原始訊息存檔（以 webhookEventId 去重；LINE 重送不會重複寫入）
    try {
      await db()
        .from("raw_messages")
        .upsert(
          {
            event_id: ev.webhookEventId ?? null,
            line_message_id: ev.message?.id ?? null,
            line_user_id: userId,
            event_type: ev.type,
            message_type: ev.message?.type ?? null,
            text: ev.message?.text ?? null,
            payload: ev,
            allowed: isAllowed,
          },
          { onConflict: "event_id", ignoreDuplicates: true },
        );
    } catch (e) {
      console.error("raw_messages insert failed", e);
    }

    if (!ev.replyToken || ev.type !== "message") continue;

    // 3. 白名單：其他人傳訊息不觸發任何功能（也不回覆）
    if (!isAllowed) {
      if (bootstrap && userId) await replyText(ev.replyToken, `你的 LINE userId：${userId}`, token);
      continue;
    }

    // 階段 1：只確認收得到，之後接 AI 判讀與確認卡
    await replyText(ev.replyToken, "收到（階段 1 測試）", token);
  }

  return new Response("ok");
}
