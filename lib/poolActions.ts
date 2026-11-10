import { db } from "./db.js";
import { workKind } from "./draft.js";
import { dayInfo } from "./holidays.js";
import { loadRuleContext } from "./ruleContext.js";
import { blockTexts, evaluateItems } from "./rules.js";
import { loadAround, suggestPeople } from "./suggest.js";
import type { BoardPerson } from "./board.js";
import type { DraftItem } from "./types.js";

export type ActionResult = { ok: true; names: string[] } | { ok: false; status: number; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

interface TaskRow {
  id: string; title: string; work: string | null; priority: string; wanted_date: string | null; headcount: number | null;
  start_time: string | null; end_time: string | null; status: string; sites: { name: string } | null; assignments: { id: string }[];
}

async function loadTask(taskId: string): Promise<TaskRow | null> {
  const { data } = await db()
    .from("tasks")
    .select("id, title, work, priority, wanted_date, headcount, start_time, end_time, status, sites(name), assignments(id)")
    .eq("id", taskId)
    .maybeSingle();
  return (data as unknown as TaskRow) ?? null;
}

/** 重新依規則算一次建議人選並排入；不信任前端傳來的人名，只收 task_id */
export async function assignSuggested(taskId: string, actor: string): Promise<ActionResult> {
  if (!UUID.test(taskId)) return { ok: false, status: 400, error: "資料格式不對" };
  const t = await loadTask(taskId);
  if (!t) return { ok: false, status: 404, error: "找不到這項工作" };
  if (t.status !== "to_handle") return { ok: false, status: 409, error: "這項工作已經處理過了" };
  if (t.assignments.length) return { ok: false, status: 409, error: "這項工作已經排好人了" };
  if (!t.wanted_date) return { ok: false, status: 409, error: "日期還沒定，請先在聊天室補上日期" };

  const date = t.wanted_date;
  const { data: people, error: e1 } = await db().from("people").select("id, name, nickname, role, active, sort_order, constraints");
  if (e1) throw e1;
  const { data: asg, error: e2 } = await db().from("assignments").select("person_id, work_date").gte("work_date", addDays(date, -3)).lte("work_date", addDays(date, 3));
  if (e2) throw e2;
  const { data: lv, error: e3 } = await db().from("leaves").select("person_id").eq("approved", true).eq("leave_date", date);
  if (e3) throw e3;

  const busy = new Set<string>([
    ...(asg ?? []).filter((a: { work_date: string }) => a.work_date === date).map((a: { person_id: string }) => `${a.person_id}|${date}`),
    ...(lv ?? []).map((l: { person_id: string }) => `${l.person_id}|${date}`),
  ]);
  const sug = suggestPeople({ title: t.title, work: t.work, wanted_date: date, headcount: t.headcount }, (people ?? []) as BoardPerson[], busy, loadAround(asg ?? [], date));
  if (!sug.ids.length) return { ok: false, status: 409, error: sug.reason };

  // 與確認卡同一套規則：有衝突就擋下
  const item: DraftItem = {
    site: t.sites?.name ?? null, work: t.work ?? t.title, date, time_slot: null, people: [], vehicle: null, headcount: t.headcount,
    priority: (["low", "normal", "high"].includes(t.priority) ? t.priority : "normal") as DraftItem["priority"],
    fixed: false, start_time: t.start_time?.slice(0, 5) ?? null, end_time: t.end_time?.slice(0, 5) ?? null,
    uncertain: [], person_ids: sug.ids, person_names: sug.names, unknown_people: [],
  };
  const blocks = blockTexts(evaluateItems([item], await loadRuleContext([item])));
  if (blocks.length) return { ok: false, status: 409, error: `有衝突，不能排入：${blocks.join("；")}` };

  // 寫入前再確認一次沒有被別人排掉（降低重複點擊的風險）
  const again = await loadTask(taskId);
  if (!again || again.status !== "to_handle" || again.assignments.length) return { ok: false, status: 409, error: "這項工作已經處理過了" };

  const rows = sug.ids.map((pid) => ({ task_id: t.id, person_id: pid, work_date: date, kind: workKind(t.work ?? t.title), fixed: false, start_time: t.start_time, end_time: t.end_time, day_type: dayInfo(date).day_type, pay_mode: dayInfo(date).pay_mode }));
  const { error } = await db().from("assignments").insert(rows);
  if (error) throw error;
  await db().from("audit_log").insert({ actor, action: "pool.assign", entity: "tasks", entity_id: t.id, detail: { names: sug.names, date } });
  return { ok: true, names: sug.names };
}

export async function cancelTask(taskId: string, actor: string): Promise<ActionResult> {
  if (!UUID.test(taskId)) return { ok: false, status: 400, error: "資料格式不對" };
  const t = await loadTask(taskId);
  if (!t) return { ok: false, status: 404, error: "找不到這項工作" };
  if (t.status !== "to_handle" || t.assignments.length) return { ok: false, status: 409, error: "這項工作已經處理過了，無法取消" };
  const { error } = await db().from("tasks").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", taskId).eq("status", "to_handle");
  if (error) throw error;
  await db().from("audit_log").insert({ actor, action: "pool.cancel", entity: "tasks", entity_id: taskId });
  return { ok: true, names: [] };
}
