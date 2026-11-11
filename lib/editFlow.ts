import { db } from "./db.js";
import { workKind } from "./draft.js";
import { dayInfo } from "./holidays.js";
import type { EditableJob } from "./flex.js";
import type { DraftItem } from "./types.js";

/** 按了「修改內容」之後，這段時間內的下一則訊息當作修改指示（每次修改成功就重新計時） */
export const AWAIT_EDIT_MINUTES = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);

/** 這個人正在修改的那張卡（沒有、或已過期就是 null） */
export async function findEditingDraft(userId: string) {
  const since = new Date(Date.now() - AWAIT_EDIT_MINUTES * 60_000).toISOString();
  const { data, error } = await db()
    .from("drafts")
    .select("id, items, leaves")
    .eq("line_user_id", userId)
    .in("status", ["pending", "later"])
    .gte("awaiting_edit_at", since)
    .order("awaiting_edit_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("awaiting_edit lookup failed", error);
    return null;
  }
  return data as { id: string; items: DraftItem[]; leaves: unknown } | null;
}

/** 這個人最近一張還沒處理的卡：讓他直接打「確認」也能確認 */
export async function latestOpenDraft(userId: string) {
  const { data } = await db()
    .from("drafts")
    .select("id, items")
    .eq("line_user_id", userId)
    .in("status", ["pending", "later"])
    .order("created_at", { ascending: false })
    .limit(5);
  return ((data ?? []) as { id: string; items: DraftItem[] }[]).find((d) => Array.isArray(d.items) && d.items.length > 0) ?? null;
}

/** 可以修改的工作：還沒做完（待處理）、日期是今天以後或還沒定 */
export async function listEditableJobs(today: string): Promise<EditableJob[]> {
  const { data, error } = await db()
    .from("tasks")
    .select("id, title, wanted_date, assignments(work_date)")
    .eq("status", "to_handle")
    .eq("follow_up", false)
    .or(`wanted_date.gte.${today},wanted_date.is.null`)
    .order("wanted_date", { ascending: true, nullsFirst: false })
    .limit(30);
  if (error) throw error;
  type Row = { id: string; title: string; wanted_date: string | null; assignments: { work_date: string }[] };
  return ((data ?? []) as Row[])
    .map((t) => ({ task_id: t.id, title: t.title, date: t.wanted_date ?? t.assignments[0]?.work_date ?? null }))
    .filter((j) => !j.date || j.date >= today);
}

/** 從已排的工作還原成可編輯的卡片項目（帶著 task_id，確認時更新而不是新增） */
export async function draftItemFromTask(taskId: string): Promise<DraftItem | null> {
  if (!UUID.test(taskId)) return null;
  const { data, error } = await db()
    .from("tasks")
    .select("id, title, work, priority, wanted_date, headcount, start_time, end_time, status, sites(name), assignments(person_id, work_date, start_time, end_time, fixed, people(name), vehicles(name))")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const t = data as unknown as {
    id: string; title: string; work: string | null; priority: DraftItem["priority"]; wanted_date: string | null; headcount: number | null;
    start_time: string | null; end_time: string | null; status: string; sites: { name: string } | null;
    assignments: { person_id: string; work_date: string; start_time: string | null; end_time: string | null; fixed: boolean; people: { name: string } | null; vehicles: { name: string } | null }[];
  };
  if (t.status !== "to_handle") return null;
  const a = t.assignments;
  const first = a[0];
  const ids = [...new Set(a.map((x) => x.person_id))];
  const names = ids.map((id) => a.find((x) => x.person_id === id)?.people?.name ?? id);
  return {
    site: t.sites?.name ?? null,
    work: t.work ?? t.title,
    date: first?.work_date ?? t.wanted_date,
    time_slot: null,
    people: names,
    vehicle: first?.vehicles?.name ?? null,
    headcount: t.headcount,
    priority: t.priority,
    fixed: a.some((x) => x.fixed),
    start_time: hhmm(first?.start_time ?? t.start_time),
    end_time: hhmm(first?.end_time ?? t.end_time),
    uncertain: [],
    person_ids: ids,
    person_names: names,
    unknown_people: [],
    task_id: t.id,
  };
}

/** 把修改後的項目寫回已排的工作：先寫新的排班，再刪舊的，中途失敗也不會把原本的排班弄丟 */
export async function saveEditedTask(it: DraftItem, vehicleId: Map<string, string>): Promise<{ people: number }> {
  if (!it.task_id) throw new Error("not an edit item");
  const { data: site } = it.site ? await db().from("sites").select("id").eq("name", it.site).maybeSingle() : { data: null };
  const { data: old, error: e0 } = await db().from("assignments").select("id").eq("task_id", it.task_id);
  if (e0) throw e0;

  const { error: e1 } = await db()
    .from("tasks")
    .update({
      title: [it.site, it.work].filter(Boolean).join(" "),
      site_id: site?.id ?? null,
      priority: it.priority,
      work: it.work,
      wanted_date: it.date,
      headcount: it.headcount,
      start_time: it.start_time ?? null,
      end_time: it.end_time ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", it.task_id)
    .eq("status", "to_handle");
  if (e1) throw e1;

  let people = 0;
  if (it.date && it.person_ids?.length) {
    const info = dayInfo(it.date);
    const rows = it.person_ids.map((pid) => ({
      task_id: it.task_id, person_id: pid, work_date: it.date, kind: workKind(it.work), fixed: it.fixed,
      start_time: it.start_time ?? null, end_time: it.end_time ?? null,
      vehicle_id: (it.vehicle && vehicleId.get(it.vehicle)) || null,
      day_type: info.day_type, pay_mode: info.pay_mode,
    }));
    const { error: e2 } = await db().from("assignments").insert(rows);
    if (e2) throw e2;
    people = rows.length;
  }
  const oldIds = ((old ?? []) as { id: string }[]).map((r) => r.id);
  if (oldIds.length) {
    const { error: e3 } = await db().from("assignments").delete().in("id", oldIds);
    if (e3) throw e3;
  }
  return { people };
}
