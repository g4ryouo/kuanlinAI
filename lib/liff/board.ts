import { db } from "../db.js";
import { shapeBoard, rangeFor, type BoardAssignment, type BoardPerson } from "../board.js";
import { authorize } from "../liffAuth.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

  const url = new URL(request.url);
  const view = url.searchParams.get("view") === "month" ? "month" : "week";
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const asked = url.searchParams.get("date");
  const anchor = asked && DATE.test(asked) && !Number.isNaN(Date.parse(asked)) ? asked : today;
  const { from, to } = rangeFor(view, anchor);

  try {
    const { data: people, error: e1 } = await db()
      .from("people")
      .select("id, name, nickname, role, active, sort_order, constraints");
    if (e1) throw e1;
    const { data: asg, error: e2 } = await db()
      .from("assignments")
      .select("person_id, work_date, start_time, end_time, kind, pay_mode, vehicles(name), tasks(title, sites(name))")
      .gte("work_date", from)
      .lte("work_date", to);
    if (e2) throw e2;
    const { data: lv, error: e3 } = await db()
      .from("leaves")
      .select("person_id, leave_date")
      .eq("approved", true)
      .gte("leave_date", from)
      .lte("leave_date", to);
    if (e3) throw e3;

    return Response.json(
      shapeBoard(view, anchor, today, (people ?? []) as BoardPerson[], (asg ?? []) as unknown as BoardAssignment[], lv ?? []),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error("liff board failed", e);
    return Response.json({ error: "讀取資料失敗，請稍後再試" }, { status: 500 });
  }
}
