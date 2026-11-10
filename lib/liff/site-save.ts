import { db } from "../db.js";
import { authorize } from "../liffAuth.js";
import { validateSiteInput } from "../sites.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 新增（沒有 id）或更新（有 id）案場主檔 */
export async function POST(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "資料格式不對" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (id && !UUID.test(id)) return Response.json({ error: "資料格式不對" }, { status: 400 });

  const v = validateSiteInput(body, !id);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });

  try {
    const row = { ...v.value, updated_at: new Date().toISOString() };
    const q = id ? db().from("sites").update(row).eq("id", id) : db().from("sites").insert(row);
    const { data, error } = await q.select("id").maybeSingle();
    if (error) {
      if ((error as { code?: string }).code === "23505") return Response.json({ error: "已經有同名的案場" }, { status: 409 });
      throw error;
    }
    if (!data) return Response.json({ error: "找不到這個案場" }, { status: 404 });
    await db().from("audit_log").insert({ actor: auth.userId, action: id ? "site.update" : "site.create", entity: "sites", entity_id: data.id });
    return Response.json({ ok: true, id: data.id });
  } catch (e) {
    console.error("site-save failed", e);
    return Response.json({ error: "儲存失敗，請稍後再試" }, { status: 500 });
  }
}
