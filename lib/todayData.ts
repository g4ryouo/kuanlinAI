import { db } from "./db.js";
import { shapeToday, type AssignmentRow, type TodayView } from "./today.js";

/** 網頁與聊天室共用：某一天的排班與請假 */
export async function loadTodayView(date: string): Promise<TodayView> {
  const { data: rows, error } = await db()
    .from("assignments")
    .select("task_id, work_date, start_time, end_time, kind, pay_mode, people(name), vehicles(name), tasks(title, sites(name))")
    .eq("work_date", date);
  if (error) throw error;
  const { data: lv, error: e2 } = await db().from("leaves").select("people(name)").eq("leave_date", date).eq("approved", true);
  if (e2) throw e2;
  const leaveNames = ((lv ?? []) as unknown as { people: { name: string } | null }[]).flatMap((l) => (l.people ? [l.people.name] : []));
  return shapeToday(date, (rows ?? []) as unknown as AssignmentRow[], leaveNames);
}
