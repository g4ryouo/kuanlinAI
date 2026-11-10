import { sendReminder } from "../../lib/briefSend.js";
import { env } from "../../lib/env.js";
import { KINDS, type ReminderKind } from "../../lib/reminders.js";

/**
 * 定時提醒：?kind=morning（07:00 早晨簡報）｜arrive（10:00 抵達確認）｜done（16:00 完工確認）｜evening（20:00 明日預覽）
 * 需帶 Authorization: Bearer <CRON_SECRET>。
 * ?dry=1 只預覽內容不推播；?force=1 沒內容也送；?resend=1 今天已推過也再送一次（測試用）
 */
export async function GET(request: Request): Promise<Response> {
  const secret = env("CRON_SECRET");
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const q = new URL(request.url).searchParams;
  const kind = (q.get("kind") ?? "morning") as ReminderKind;
  if (!KINDS.includes(kind)) return Response.json({ ok: false, error: `kind 必須是 ${KINDS.join("、")}` }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await sendReminder(kind, { dry: q.get("dry") === "1", force: q.get("force") === "1", resend: q.get("resend") === "1" })) });
  } catch (e) {
    console.error("reminder failed", kind, e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "error" }, { status: 500 });
  }
}
