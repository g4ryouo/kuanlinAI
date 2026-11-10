import { db } from "../../lib/db.js";
import { authorize } from "../../lib/liffAuth.js";
import { shapeToday, type AssignmentRow } from "../../lib/today.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

  const url = new URL(request.url);
  const asked = url.searchParams.get("date");
  const date = asked && DATE.test(asked) ? asked : new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });

  try {
    const { data: rows, error } = await db()
      .from("assignments")
      .select("task_id, work_date, start_time, end_time, kind, pay_mode, people(name), vehicles(name), tasks(title, sites(name))")
      .eq("work_date", date);
    if (error) throw error;
    const { data: lv, error: e2 } = await db().from("leaves").select("people(name)").eq("leave_date", date).eq("approved", true);
    if (e2) throw e2;
    const leaveNames = ((lv ?? []) as unknown as { people: { name: string } | null }[]).flatMap((l) => (l.people ? [l.people.name] : []));
    return Response.json(shapeToday(date, (rows ?? []) as unknown as AssignmentRow[], leaveNames), {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    console.error("liff today failed", e);
    return Response.json({ error: "讀取資料失敗，請稍後再試" }, { status: 500 });
  }
}
