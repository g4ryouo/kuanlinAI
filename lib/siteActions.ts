import { db } from "./db.js";

export type SiteActionResult = { ok: true } | { ok: false; status: number; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 結案或重新開啟：只改標記，所有歷史資料都保留 */
export async function setArchived(id: string, archived: boolean, actor: string): Promise<SiteActionResult> {
  if (!UUID.test(id)) return { ok: false, status: 400, error: "資料格式不對" };
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("sites")
    .update({ archived_at: archived ? now : null, updated_at: now })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, status: 404, error: "找不到這個案場" };
  await db().from("audit_log").insert({ actor, action: archived ? "site.archive" : "site.reopen", entity: "sites", entity_id: id });
  return { ok: true };
}

/** 真的刪除：只允許建錯、沒有任何工作紀錄的案場，其餘請用結案 */
export async function deleteSite(id: string, actor: string): Promise<SiteActionResult> {
  if (!UUID.test(id)) return { ok: false, status: 400, error: "資料格式不對" };
  const { data: used, error: e1 } = await db().from("tasks").select("id").eq("site_id", id).limit(1);
  if (e1) throw e1;
  if (used && used.length) return { ok: false, status: 409, error: "這個案場有工作紀錄，不能刪除，請改用「結案」" };
  const { data, error } = await db().from("sites").delete().eq("id", id).select("id").maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, status: 404, error: "找不到這個案場" };
  await db().from("audit_log").insert({ actor, action: "site.delete", entity: "sites", entity_id: id });
  return { ok: true };
}
