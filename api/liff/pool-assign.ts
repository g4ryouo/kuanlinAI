import { authorize } from "../../lib/liffAuth.js";
import { assignSuggested } from "../../lib/poolActions.js";

export async function POST(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
  let taskId = "";
  try {
    taskId = String(((await request.json()) as { task_id?: unknown }).task_id ?? "");
  } catch {
    return Response.json({ error: "資料格式不對" }, { status: 400 });
  }
  try {
    const r = await assignSuggested(taskId, auth.userId);
    return r.ok ? Response.json({ ok: true, names: r.names }) : Response.json({ error: r.error }, { status: r.status });
  } catch (e) {
    console.error("pool-assign failed", e);
    return Response.json({ error: "處理失敗，請稍後再試" }, { status: 500 });
  }
}
