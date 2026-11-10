import { authorize } from "../liffAuth.js";
import { loadTodayView } from "../todayData.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

  const url = new URL(request.url);
  const asked = url.searchParams.get("date");
  const date = asked && DATE.test(asked) ? asked : new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });

  try {
    return Response.json(await loadTodayView(date), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("liff today failed", e);
    return Response.json({ error: "讀取資料失敗，請稍後再試" }, { status: 500 });
  }
}
