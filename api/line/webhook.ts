import { allowedUserIds, env } from "../../lib/env.js";
import { db } from "../../lib/db.js";
import { replyText, verifySignature, type LineEvent } from "../../lib/line.js";
import { handleMessage, handlePostback } from "../../lib/handlers.js";
import { waitUntil } from "@vercel/functions";

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

  // 先回 200 給 LINE，AI 判讀等耗時工作放到背景處理
  waitUntil(
    (async () => {
      for (const ev of events) {
        try {
          await processEvent(ev, allowed, bootstrap, token);
        } catch (e) {
          console.error("event failed", ev.webhookEventId, e);
          if (ev.replyToken && ev.source?.userId && allowed.has(ev.source.userId)) {
            await replyText(ev.replyToken, "處理時發生問題，請稍後再傳一次。", token).catch(() => {});
          }
        }
      }
    })(),
  );

  return new Response("ok");
}

async function processEvent(ev: LineEvent, allowed: Set<string>, bootstrap: boolean, token: string): Promise<void> {
  const userId = ev.source?.userId ?? null;
  const isAllowed = !!userId && allowed.has(userId);

  // 原始訊息存檔（以 webhookEventId 去重；LINE 重送時不會重複處理）
  let rawId: string | null = null;
  try {
    const { data, error } = await db()
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
      )
      .select("id");
    if (error) throw error;
    if (ev.webhookEventId && (!data || data.length === 0)) return; // 重送的事件
    rawId = data?.[0]?.id ?? null;
  } catch (e) {
    console.error("raw_messages insert failed", e);
  }

  if (!ev.replyToken) return;

  // 白名單：其他人不觸發任何功能（也不回覆）
  if (!isAllowed) {
    if (bootstrap && userId && ev.type === "message") {
      await replyText(ev.replyToken, `你的 LINE userId：${userId}`, token);
    }
    return;
  }

  if (ev.type === "message") await handleMessage(ev, rawId);
  else if (ev.type === "postback") await handlePostback(ev);
}
