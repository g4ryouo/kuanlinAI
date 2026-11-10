import { db } from "../db.js";
import { loadFollowupView } from "../followupData.js";
import { authorize } from "../liffAuth.js";

export async function GET(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  try {
    const view = await loadFollowupView(today);
    const { data: sites, error } = await db().from("sites").select("id, name").is("archived_at", null).order("name");
    if (error) throw error;
    return Response.json({ today, ...view, sites: sites ?? [] }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("liff followups failed", e);
    return Response.json({ error: "讀取資料失敗，請稍後再試" }, { status: 500 });
  }
}
