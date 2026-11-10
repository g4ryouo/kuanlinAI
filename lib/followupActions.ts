import { db } from "./db.js";
import { canMove, validateFollowInput, type MoveTarget } from "./followups.js";

export type FollowResult = { ok: true; id?: string } | { ok: false; status: number; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 新增（沒有 id）或修改（有 id）追蹤事項；狀態只能透過 moveFollowup 改 */
export async function saveFollowup(body: Record<string, unknown>, actor: string): Promise<FollowResult> {
  const id = typeof body.id === "string" ? body.id : "";
  if (id && !UUID.test(id)) return { ok: false, status: 400, error: "資料格式不對" };
  const v = validateFollowInput(body, !id);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  const { status, ...fields } = v.value;
  const now = new Date().toISOString();

  if (!id) {
    const { data, error } = await db()
      .from("tasks")
      .insert({ ...fields, status, follow_up: true, waiting_since: status === "waiting_other" ? now : null })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("insert failed");
    await db().from("audit_log").insert({ actor, action: "followup.create", entity: "tasks", entity_id: data.id, detail: { status } });
    return { ok: true, id: data.id };
  }
  const { data, error } = await db().from("tasks").update({ ...fields, updated_at: now }).eq("id", id).eq("follow_up", true).select("id").maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, status: 404, error: "找不到這件事" };
  await db().from("audit_log").insert({ actor, action: "followup.update", entity: "tasks", entity_id: id });
  return { ok: true, id };
}

export async function moveFollowup(id: string, to: string, actor: string): Promise<FollowResult> {
  if (!UUID.test(id)) return { ok: false, status: 400, error: "資料格式不對" };
  const { data: cur, error: e1 } = await db().from("tasks").select("id, status").eq("id", id).eq("follow_up", true).maybeSingle();
  if (e1) throw e1;
  if (!cur) return { ok: false, status: 404, error: "找不到這件事" };
  if (!canMove(cur.status, to)) return { ok: false, status: 409, error: "這件事的狀態已經變了，請重新整理" };
  const now = new Date().toISOString();
  const target = to as MoveTarget;
  const { data, error } = await db()
    .from("tasks")
    .update({
      status: target,
      waiting_since: target === "waiting_other" ? now : null,
      completed_at: target === "done" ? now : null,
      updated_at: now,
    })
    .eq("id", id)
    .eq("status", cur.status) // 防止兩個人同時按
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, status: 409, error: "這件事剛剛被別人改過了，請重新整理" };
  await db().from("audit_log").insert({ actor, action: "followup.move", entity: "tasks", entity_id: id, detail: { from: cur.status, to } });
  return { ok: true, id };
}
