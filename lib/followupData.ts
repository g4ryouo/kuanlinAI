import { db } from "./db.js";
import { shapeFollowups, type FollowRow, type FollowView } from "./followups.js";

/** 網頁與聊天室共用：讀出所有追蹤事項並整理成三個區塊 */
export async function loadFollowupView(today: string): Promise<FollowView> {
  const { data, error } = await db()
    .from("tasks")
    .select("id, title, status, priority, contact, note, due_date, waiting_since, created_at, completed_at, site_id, sites(name)")
    .eq("follow_up", true)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return shapeFollowups((data ?? []) as unknown as FollowRow[], today);
}
