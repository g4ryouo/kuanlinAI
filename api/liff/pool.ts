import { db } from "../../lib/db.js";
import type { BoardPerson } from "../../lib/board.js";
import { hasCalendar } from "../../lib/holidays.js";
import { authorize } from "../../lib/liffAuth.js";
import { shapeAvailable, shapePool } from "../../lib/pool.js";
import type { PoolTask } from "../../lib/suggest.js";

const DAYS = 14;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

interface TaskRow {
  id: string; title: string; work: string | null; priority: string; wanted_date: string | null; headcount: number | null;
  start_time: string | null; end_time: string | null; created_at: string; sites: { name: string } | null; assignments: { id: string }[];
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const from = addDays(today, -3);
  const to = addDays(today, DAYS + 7);
  try {
    const { data: people, error: e1 } = await db().from("people").select("id, name, nickname, role, active, sort_order, constraints");
    if (e1) throw e1;
    const { data: tasks, error: e2 } = await db()
      .from("tasks")
      .select("id, title, work, priority, wanted_date, headcount, start_time, end_time, created_at, sites(name), assignments(id)")
      .eq("status", "to_handle")
      .order("created_at", { ascending: true })
      .limit(200);
    if (e2) throw e2;
    const { data: asg, error: e3 } = await db().from("assignments").select("person_id, work_date").gte("work_date", from).lte("work_date", to);
    if (e3) throw e3;
    const { data: lv, error: e4 } = await db().from("leaves").select("person_id, leave_date").eq("approved", true).gte("leave_date", from).lte("leave_date", to);
    if (e4) throw e4;

    const busy = new Set<string>([
      ...(asg ?? []).map((a: { person_id: string; work_date: string }) => `${a.person_id}|${a.work_date}`),
      ...(lv ?? []).map((l: { person_id: string; leave_date: string }) => `${l.person_id}|${l.leave_date}`),
    ]);
    const poolTasks: PoolTask[] = ((tasks ?? []) as unknown as TaskRow[])
      .filter((t) => t.assignments.length === 0)
      .map((t) => ({ id: t.id, title: t.title, work: t.work, site: t.sites?.name ?? null, priority: t.priority, wanted_date: t.wanted_date, headcount: t.headcount, start_time: t.start_time, end_time: t.end_time, created_at: t.created_at }));

    const ppl = (people ?? []) as BoardPerson[];
    const available = shapeAvailable(today, DAYS, ppl, busy, poolTasks);
    return Response.json(
      {
        today,
        pool: shapePool(poolTasks, ppl, busy, asg ?? []),
        available,
        calendarMissing: available.length > 0 ? !hasCalendar(addDays(today, DAYS)) || !hasCalendar(today) : false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error("liff pool failed", e);
    return Response.json({ error: "讀取資料失敗，請稍後再試" }, { status: 500 });
  }
}
