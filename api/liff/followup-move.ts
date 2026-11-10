import { authorize } from "../../lib/liffAuth.js";
import { moveFollowup } from "../../lib/followupActions.js";

export async function POST(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "資料格式不對" }, { status: 400 });
  }
  try {
    const r = await moveFollowup(String(body.id ?? ""), String(body.to ?? ""), auth.userId);
    return r.ok ? Response.json({ ok: true, id: r.id }) : Response.json({ error: r.error }, { status: r.status });
  } catch (e) {
    console.error("followup-move failed", e);
    return Response.json({ error: "處理失敗，請稍後再試" }, { status: 500 });
  }
}
