import { env } from "../../lib/env.js";
import { sendMorningBrief } from "../../lib/briefSend.js";

/**
 * 每天 07:30（台北）的早晨簡報。需帶 Authorization: Bearer <CRON_SECRET>。
 * ?dry=1 只預覽內容不推播；?force=1 假日也送；?resend=1 今天已推過也再送一次（測試用）
 */
export async function GET(request: Request): Promise<Response> {
  const secret = env("CRON_SECRET");
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const q = new URL(request.url).searchParams;
  try {
    return Response.json({ ok: true, ...(await sendMorningBrief({ dry: q.get("dry") === "1", force: q.get("force") === "1", resend: q.get("resend") === "1" })) });
  } catch (e) {
    console.error("morning brief failed", e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "error" }, { status: 500 });
  }
}
