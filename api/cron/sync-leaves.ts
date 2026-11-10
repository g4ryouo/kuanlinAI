import { env } from "../../lib/env.js";
import { syncLeaves } from "../../lib/syncLeaves.js";

/** 每天由 Vercel Cron 呼叫；也可手動用 Authorization: Bearer <CRON_SECRET> 觸發 */
export async function GET(request: Request): Promise<Response> {
  const secret = env("CRON_SECRET");
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  try {
    return Response.json({ ok: true, ...(await syncLeaves()) });
  } catch (e) {
    console.error("sync-leaves failed", e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "error" }, { status: 500 });
  }
}
