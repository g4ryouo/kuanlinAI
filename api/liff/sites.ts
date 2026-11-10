import { db } from "../../lib/db.js";
import { authorize } from "../../lib/liffAuth.js";
import { shapeSites, type SiteRow, type SiteTaskRow } from "../../lib/sites.js";

export async function GET(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  try {
    const { data: sites, error: e1 } = await db()
      .from("sites")
      .select("id, name, region, stage, start_date, end_date, lead_person_id, headcount_need, deadline, flexible, risks, open_issues, updated_at, archived_at, people(name, nickname)");
    if (e1) throw e1;
    const { data: tasks, error: e2 } = await db()
      .from("tasks")
      .select("site_id, status, created_at, assignments(work_date, created_at)")
      .not("site_id", "is", null)
      .limit(2000);
    if (e2) throw e2;
    const { data: people, error: e3 } = await db()
      .from("people")
      .select("id, name, nickname, role, sort_order")
      .eq("active", true)
      .in("role", ["owner", "field", "outsourced"])
      .order("sort_order", { ascending: true });
    if (e3) throw e3;

    return Response.json(
      {
        today,
        sites: shapeSites((sites ?? []) as unknown as SiteRow[], (tasks ?? []) as unknown as SiteTaskRow[], today),
        people: (people ?? []).map((p: { id: string; name: string; nickname: string | null }) => ({ id: p.id, name: p.nickname || p.name })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error("liff sites failed", e);
    return Response.json({ error: "讀取資料失敗，請稍後再試" }, { status: 500 });
  }
}
