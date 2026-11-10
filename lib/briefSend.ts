import { buildBrief, dedupeKey, pickRecipients, shouldSendBrief } from "./brief.js";
import { db } from "./db.js";
import { env } from "./env.js";
import { loadFollowupView } from "./followupData.js";
import { pushMessages } from "./line.js";
import { addDays, buildArrive, buildDone, buildEvening, type Reminder, type ReminderKind } from "./reminders.js";
import { loadTodayView } from "./todayData.js";

/** 還沒決定派誰的工作（待排池）件數 */
export async function loadPoolCount(): Promise<number> {
  const { data, error } = await db().from("tasks").select("id, assignments(id)").eq("status", "to_handle").eq("follow_up", false).limit(500);
  if (error) throw error;
  return ((data ?? []) as unknown as { assignments: { id: string }[] }[]).filter((t) => t.assignments.length === 0).length;
}

/** 想排在某一天、但還沒決定派誰的工作標題 */
export async function loadUnassignedFor(date: string): Promise<string[]> {
  const { data, error } = await db().from("tasks").select("title, assignments(id)").eq("status", "to_handle").eq("follow_up", false).eq("wanted_date", date).limit(100);
  if (error) throw error;
  return ((data ?? []) as unknown as { title: string; assignments: { id: string }[] }[]).filter((t) => t.assignments.length === 0).map((t) => t.title);
}

/** 老闆（role = owner）的 LINE userId，沒設定 BRIEF_USER_IDS 時用 */
async function loadOwnerIds(): Promise<string[]> {
  const { data, error } = await db().from("people").select("line_user_id").eq("role", "owner").eq("active", true).not("line_user_id", "is", null);
  if (error) throw error;
  return (data ?? []).map((p: { line_user_id: string }) => p.line_user_id);
}

export async function loadBrief(today: string) {
  const [todayView, follow, poolCount] = await Promise.all([loadTodayView(today), loadFollowupView(today), loadPoolCount()]);
  return { todayView, follow, brief: buildBrief({ today, todayView, follow, poolCount, liffId: env("LIFF_ID") || undefined }) };
}

/** 依種類組出提醒內容：早上簡報、10:00 抵達確認、16:00 完工確認、20:00 明日預覽 */
export async function buildReminder(kind: ReminderKind, today: string): Promise<Reminder> {
  const liffId = env("LIFF_ID") || undefined;
  if (kind === "morning") {
    const { todayView, follow, brief } = await loadBrief(today);
    const send = shouldSendBrief(today, todayView, follow);
    return { send, skipReason: send ? undefined : "假日，而且沒有排班也沒有要緊的事", text: brief.text, flex: brief.flex };
  }
  if (kind === "arrive") return buildArrive({ todayView: await loadTodayView(today), liffId });
  if (kind === "done") {
    const [todayView, follow] = await Promise.all([loadTodayView(today), loadFollowupView(today)]);
    return buildDone({ todayView, follow, liffId });
  }
  const tomorrow = addDays(today, 1);
  const [tomorrowView, follow, unassignedTomorrow] = await Promise.all([loadTodayView(tomorrow), loadFollowupView(today), loadUnassignedFor(tomorrow)]);
  return buildEvening({ tomorrow, tomorrowView, follow, unassignedTomorrow, liffId });
}

export interface ReminderResult {
  kind: ReminderKind;
  date: string;
  skipped?: string;
  preview?: string;
  recipients: { to: string; result: "sent" | "skipped" | "failed"; detail?: string }[];
}

type Claim = "new" | "retry" | "exists";

/** 先登記再推播：同一天同一種提醒同一個人只會推一次；上次失敗的允許重試 */
async function claim(kind: ReminderKind, key: string, to: string): Promise<Claim> {
  const { error } = await db().from("reminders").insert({ kind, scheduled_for: new Date().toISOString(), target_line_user_id: to, status: "pending", dedupe_key: key });
  if (!error) return "new";
  if ((error as { code?: string }).code !== "23505") throw error;
  const { data } = await db().from("reminders").select("status").eq("dedupe_key", key).maybeSingle();
  if (data?.status === "failed") {
    await db().from("reminders").update({ status: "pending" }).eq("dedupe_key", key);
    return "retry";
  }
  return "exists";
}

export async function sendReminder(kind: ReminderKind, opts: { dry?: boolean; force?: boolean; resend?: boolean } = {}): Promise<ReminderResult> {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const r = await buildReminder(kind, today);

  if (!opts.force && !r.send) return { kind, date: today, skipped: r.skipReason ?? "沒有內容", recipients: [] };
  if (opts.dry) return { kind, date: today, preview: r.text, recipients: [] };

  const recipients = pickRecipients(env("BRIEF_USER_IDS"), await loadOwnerIds());
  if (!recipients.length) return { kind, date: today, skipped: "沒有設定收件人（請設定 BRIEF_USER_IDS，或在 people 裡設定老闆的 line_user_id）", recipients: [] };

  const token = env("LINE_CHANNEL_ACCESS_TOKEN");
  const out: ReminderResult["recipients"] = [];
  for (const to of recipients) {
    const key = dedupeKey(today, to, opts.resend ? Date.now() : undefined, kind);
    if ((await claim(kind, key, to)) === "exists") {
      out.push({ to: `${to.slice(0, 6)}…`, result: "skipped", detail: "今天已經推過了" });
      continue;
    }
    const p = await pushMessages(to, [r.flex], token);
    await db().from("reminders").update({ status: p.ok ? "sent" : "failed", sent_at: p.ok ? new Date().toISOString() : null }).eq("dedupe_key", key);
    out.push({ to: `${to.slice(0, 6)}…`, result: p.ok ? "sent" : "failed", ...(p.ok ? {} : { detail: `LINE ${p.status} ${p.detail ?? ""}`.trim() }) });
  }
  return { kind, date: today, recipients: out };
}
