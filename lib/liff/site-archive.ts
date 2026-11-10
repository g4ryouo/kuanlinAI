import { authorize } from "../liffAuth.js";
import { setArchived } from "../siteActions.js";

export async function POST(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
  let body: { id?: unknown; archived?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "資料格式不對" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (typeof body.archived !== "boolean") return Response.json({ error: "資料格式不對" }, { status: 400 });
  try {
    const r = await setArchived(id, body.archived === true, auth.userId);
    return r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: r.status });
  } catch (e) {
    console.error("site-archive failed", e);
    return Response.json({ error: "處理失敗，請稍後再試" }, { status: 500 });
  }
}
