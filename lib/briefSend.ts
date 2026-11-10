import { buildBrief, dedupeKey, pickRecipients, shouldSendBrief } from "./brief.js";
import { db } from "./db.js";
import { allowedUserIds, env } from "./env.js";
import { loadFollowupView } from "./followupData.js";
import { pushMessages } from "./line.js";
import { loadTodayView } from "./todayData.js";

/** 還沒決定派誰的工作（待排池）件數 */
export async function loadPoolCount(): Promise<number> {
  const { data, error } = await db().from("tasks").select("id, assignments(id)").eq("status", "to_handle").eq("follow_up", false).limit(500);
  if (error) throw error;
  return ((data ?? []) as unknown as { assignments: { id: string }[] }[]).filter((t) => t.assignments.length === 0).length;
}

export async function loadBrief(today: string) {
  const [todayView, follow, poolCount] = await Promise.all([loadTodayView(today), loadFollowupView(today), loadPoolCount()]);
  return { todayView, follow, brief: buildBrief({ today, todayView, follow, poolCount, liffId: env("LIFF_ID") || undefined }) };
}

export interface BriefResult {
  date: string;
  skipped?: string;
  preview?: string;
  recipients: { to: string; result: "sent" | "skipped" | "failed"; detail?: string }[];
}

type Claim = "new" | "retry" | "exists";

/** 先登記再推播：同一天同一個人只會推一次；上次失敗的允許重試 */
async function claim(key: string, to: string): Promise<Claim> {
  const { error } = await db().from("reminders").insert({ kind: "morning", scheduled_for: new Date().toISOString(), target_line_user_id: to, status: "pending", dedupe_key: key });
  if (!error) return "new";
  if ((error as { code?: string }).code !== "23505") throw error;
  const { data } = await db().from("reminders").select("status").eq("dedupe_key", key).maybeSingle();
  if (data?.status === "failed") {
    await db().from("reminders").update({ status: "pending" }).eq("dedupe_key", key);
    return "retry";
  }
  return "exists";
}

export async function sendMorningBrief(opts: { dry?: boolean; force?: boolean; resend?: boolean } = {}): Promise<BriefResult> {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const { todayView, follow, brief } = await loadBrief(today);

  if (!opts.force && !shouldSendBrief(today, todayView, follow)) return { date: today, skipped: "假日，而且沒有排班也沒有要緊的事", recipients: [] };
  if (opts.dry) return { date: today, preview: brief.text, recipients: [] };

  const token = env("LINE_CHANNEL_ACCESS_TOKEN");
  const out: BriefResult["recipients"] = [];
  for (const to of pickRecipients(env("BRIEF_USER_IDS"), allowedUserIds())) {
    const key = dedupeKey(today, to, opts.resend ? Date.now() : undefined);
    if ((await claim(key, to)) === "exists") {
      out.push({ to: `${to.slice(0, 6)}…`, result: "skipped", detail: "今天已經推過了" });
      continue;
    }
    const r = await pushMessages(to, [brief.flex], token);
    await db().from("reminders").update({ status: r.ok ? "sent" : "failed", sent_at: r.ok ? new Date().toISOString() : null }).eq("dedupe_key", key);
    out.push({ to: `${to.slice(0, 6)}…`, result: r.ok ? "sent" : "failed", ...(r.ok ? {} : { detail: `LINE ${r.status} ${r.detail ?? ""}`.trim() }) });
  }
  return { date: today, recipients: out };
}
