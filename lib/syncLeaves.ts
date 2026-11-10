import { db } from "./db.js";
import { env } from "./env.js";
import { batchGetValues, getAccessToken } from "./google.js";
import { expandDates, parseLeaves } from "./leaves.js";

const TAB = "請假申請表";

/** 從請假申請表同步「審核通過」的請假日期到 leaves 表。只讀姓名、日期、審核欄，不讀請假原因 */
export async function syncLeaves(): Promise<{ rows: number; days: number; unknown: string[]; inserted: number; removed: number }> {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const token = await getAccessToken(env("GOOGLE_SERVICE_ACCOUNT_JSON"));
  // B~E：姓名、類別、開始、結束；H：審核通過；J：申請日期（用來推年份）。刻意跳過 G 欄「請假原因」
  const [dates, status, applied] = await batchGetValues(
    env("LEAVE_SHEET_ID"),
    [`${TAB}!B2:E2000`, `${TAB}!H2:H2000`, `${TAB}!J2:J2000`],
    token,
  ).then((r) => [r[0] ?? [], r[1] ?? [], r[2] ?? []] as const);

  const leaves = parseLeaves(dates, status, applied, today);
  const { data: people, error } = await db().from("people").select("id, name");
  if (error) throw error;
  const byName = new Map((people ?? []).map((p: { id: string; name: string }) => [p.name, p.id]));

  const unknown = new Set<string>();
  const wanted = new Map<string, { person_id: string; leave_date: string; approved: true }>();
  for (const l of leaves) {
    const id = byName.get(l.name);
    if (!id) {
      unknown.add(l.name);
      continue;
    }
    for (const d of expandDates(l)) wanted.set(`${id}|${d}`, { person_id: id, leave_date: d, approved: true });
  }

  // 只處理今天往前 30 天起的資料，過去更久的不動
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  const { data: existing, error: e2 } = await db().from("leaves").select("person_id, leave_date").gte("leave_date", since);
  if (e2) throw e2;

  const rows = [...wanted.values()].filter((r) => r.leave_date >= since);
  if (rows.length) {
    const { error: e3 } = await db().from("leaves").upsert(rows, { onConflict: "person_id,leave_date" });
    if (e3) throw e3;
  }

  // 表單上已被取消或改成未通過的，從資料庫移除
  const stale = (existing ?? []).filter((x: { person_id: string; leave_date: string }) => !wanted.has(`${x.person_id}|${x.leave_date}`));
  for (const s of stale) {
    await db().from("leaves").delete().eq("person_id", s.person_id).eq("leave_date", s.leave_date);
  }

  return { rows: leaves.length, days: wanted.size, unknown: [...unknown], inserted: rows.length, removed: stale.length };
}
