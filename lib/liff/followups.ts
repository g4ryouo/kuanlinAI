import { db } from "../db.js";
import { shapeFollowups, type FollowRow } from "../followups.js";
import { authorize } from "../liffAuth.js";

export async function GET(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  try {
    const { data: rows, error: e1 } = await db()
      .from("tasks")
      .select("id, title, status, priority, contact, note, due_date, waiting_since, created_at, completed_at, site_id, sites(name)")
      .eq("follow_up", true)
      .order("created_at", { ascending: false })
      .limit(500);
    if (e1) throw e1;
    const { data: sites, error: e2 } = await db().from("sites").select("id, name").is("archived_at", null).order("name");
    if (e2) throw e2;
    return Response.json(
      { today, ...shapeFollowups((rows ?? []) as unknown as FollowRow[], today), sites: sites ?? [] },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error("liff followups failed", e);
    return Response.json({ error: "讀取資料失敗，請稍後再試" }, { status: 500 });
  }
}
