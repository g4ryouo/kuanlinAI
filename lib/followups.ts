export const FOLLOW_STATUSES = ["to_reply", "waiting_other", "flexible_hold"] as const;
export type FollowStatus = (typeof FOLLOW_STATUSES)[number];
export type MoveTarget = FollowStatus | "done" | "cancelled";

export const STATUS_LABEL: Record<FollowStatus, string> = {
  to_reply: "待我回覆",
  waiting_other: "等對方回覆",
  flexible_hold: "機動待辦",
};

export const WAIT_WARN_DAYS = 3; // 等超過幾天用紅字提醒
export const DONE_KEEP_DAYS = 14;

export interface FollowRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  contact: string | null;
  note: string | null;
  due_date: string | null;
  waiting_since: string | null;
  created_at: string;
  completed_at: string | null;
  site_id: string | null;
  sites: { name: string } | null;
}

export interface FollowItem {
  id: string;
  title: string;
  status: FollowStatus | "done";
  site: string | null;
  site_id: string | null;
  contact: string | null;
  note: string | null;
  due_date: string | null;
  days_to_due: number | null;
  overdue: boolean;
  urgent: boolean;
  age_days: number;
  waiting_days: number | null; // 只有「等對方回覆」才有
  wait_warn: boolean;
  completed_at: string | null;
}

export interface FollowView {
  to_reply: FollowItem[];
  waiting_other: FollowItem[];
  flexible_hold: FollowItem[];
  done: FollowItem[];
}

const DAY = 86_400_000;
const d0 = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const diff = (a: string, b: string) => Math.round((d0(a) - d0(b)) / DAY);

export function shapeFollowups(rows: FollowRow[], today: string): FollowView {
  const view: FollowView = { to_reply: [], waiting_other: [], flexible_hold: [], done: [] };
  for (const r of rows) {
    const status = r.status === "done" ? "done" : (FOLLOW_STATUSES as readonly string[]).includes(r.status) ? (r.status as FollowStatus) : null;
    if (!status) continue;
    if (status === "done") {
      if (!r.completed_at || diff(today, r.completed_at) > DONE_KEEP_DAYS) continue;
    }
    const toDue = r.due_date ? diff(r.due_date, today) : null;
    const waiting = status === "waiting_other" ? Math.max(0, diff(today, r.waiting_since ?? r.created_at)) : null;
    const item: FollowItem = {
      id: r.id, title: r.title, status, site: r.sites?.name ?? null, site_id: r.site_id, contact: r.contact, note: r.note,
      due_date: r.due_date, days_to_due: toDue, overdue: toDue !== null && toDue < 0 && status !== "done", urgent: r.priority === "high",
      age_days: Math.max(0, diff(today, r.created_at)), waiting_days: waiting, wait_warn: waiting !== null && waiting >= WAIT_WARN_DAYS,
      completed_at: r.completed_at,
    };
    view[status].push(item);
  }
  // 逾期的最前面；其次急件；其次期限近的；最後等最久的
  const key = (i: FollowItem) => [i.overdue ? 0 : 1, i.urgent ? 0 : 1, i.days_to_due ?? 9999, -(i.waiting_days ?? i.age_days)] as const;
  for (const list of [view.to_reply, view.waiting_other, view.flexible_hold]) {
    list.sort((a, b) => {
      const ka = key(a), kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return a.title.localeCompare(b.title, "zh-Hant");
    });
  }
  view.done.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  return view;
}

/** 允許的狀態變更：只在追蹤事項之間移動，或完成、取消；完成後可「重新開啟」回待我回覆 */
export function canMove(from: string, to: string): boolean {
  if (from === to) return false;
  const fromOk = (FOLLOW_STATUSES as readonly string[]).includes(from) || from === "done";
  const toOk = (FOLLOW_STATUSES as readonly string[]).includes(to) || to === "done" || to === "cancelled";
  if (!fromOk || !toOk) return false;
  if (from === "done") return to === "to_reply"; // 重新開啟
  return true;
}

// ---------------- 輸入驗證 ----------------
export interface FollowInput {
  title: string;
  status?: FollowStatus;
  site_id: string | null;
  contact: string | null;
  note: string | null;
  due_date: string | null;
  priority: "normal" | "high";
}
export type Validated = { ok: true; value: FollowInput } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export function validateFollowInput(body: unknown, creating: boolean): Validated {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const text = (k: string, max: number, label: string): string | null | Error => {
    const v = b[k];
    if (v == null || v === "") return null;
    if (typeof v !== "string") return new Error(`${label}格式不對`);
    const t = v.trim();
    return t.length > max ? new Error(`${label}最多 ${max} 個字`) : t || null;
  };
  const title = text("title", 80, "標題");
  if (title instanceof Error) return { ok: false, error: title.message };
  if (!title) return { ok: false, error: "請填這件事是什麼" };
  const contact = text("contact", 40, "對方");
  const note = text("note", 500, "備註");
  for (const v of [contact, note]) if (v instanceof Error) return { ok: false, error: v.message };

  let due: string | null = null;
  if (b.due_date != null && b.due_date !== "") {
    if (typeof b.due_date !== "string" || !validDate(b.due_date)) return { ok: false, error: "期限日期不對" };
    due = b.due_date;
  }
  const site = b.site_id;
  if (site != null && site !== "" && !(typeof site === "string" && UUID.test(site))) return { ok: false, error: "案場資料不對" };

  let status: FollowStatus | undefined;
  if (creating) {
    if (!(FOLLOW_STATUSES as readonly string[]).includes(String(b.status))) return { ok: false, error: "請選擇狀態" };
    status = b.status as FollowStatus;
  }
  if (b.urgent != null && typeof b.urgent !== "boolean") return { ok: false, error: "急件資料不對" };

  return {
    ok: true,
    value: { title, ...(status ? { status } : {}), site_id: site ? String(site) : null, contact: contact as string | null, note: note as string | null, due_date: due, priority: b.urgent === true ? "high" : "normal" },
  };
}
