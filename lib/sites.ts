export const STAGES = ["survey", "quote", "construction", "improve", "acceptance", "billing"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  survey: "場勘", quote: "報價", construction: "施工", improve: "改善", acceptance: "驗收", billing: "請款",
};

export const STALE_DAYS = 30;
export const UPCOMING_DAYS = 14;

export interface SiteRow {
  id: string;
  name: string;
  region: string | null;
  stage: string | null;
  start_date: string | null;
  end_date: string | null;
  lead_person_id: string | null;
  headcount_need: string | null;
  deadline: string | null;
  flexible: boolean;
  risks: string | null;
  open_issues: string | null;
  updated_at: string;
  archived_at?: string | null;
  people: { name: string; nickname: string | null } | null;
}

export interface SiteTaskRow {
  site_id: string | null;
  status: string;
  created_at: string;
  assignments: { work_date: string; created_at: string }[];
}

export interface SiteCard {
  id: string;
  name: string;
  region: string | null;
  stage: Stage | null;
  stage_label: string | null;
  start_date: string | null;
  end_date: string | null;
  lead_person_id: string | null;
  lead_name: string | null;
  headcount_need: string | null;
  deadline: string | null;
  days_to_deadline: number | null;
  flexible: boolean;
  risks: string | null;
  open_issues: string | null;
  upcoming_people_days: number; // 未來兩週排班人次
  pool_count: number; // 待排工作
  last_activity: string; // YYYY-MM-DD
  days_idle: number;
  stale: boolean;
  archived: boolean; // 已結案
  task_count: number; // 有幾筆工作紀錄；0 才能真的刪除
}

const DAY = 86_400_000;
const ymd = (iso: string) => iso.slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(`${ymd(a)}T00:00:00Z`) - Date.parse(`${ymd(b)}T00:00:00Z`)) / DAY);

/** 案場卡片：主檔欄位加上「從排班與任務算出來」的動態；久未更新要提示 */
export function shapeSites(sites: SiteRow[], tasks: SiteTaskRow[], today: string): SiteCard[] {
  const cards = sites.map((s): SiteCard => {
    let last = ymd(s.updated_at);
    let upcoming = 0;
    let pool = 0;
    let taskCount = 0;
    for (const t of tasks) {
      if (t.site_id !== s.id) continue;
      taskCount++;
      if (ymd(t.created_at) > last) last = ymd(t.created_at);
      if (t.status === "to_handle" && t.assignments.length === 0) pool++;
      for (const a of t.assignments) {
        if (ymd(a.created_at) > last) last = ymd(a.created_at);
        const d = days(a.work_date, today);
        if (d >= 0 && d <= UPCOMING_DAYS) upcoming++;
      }
    }
    const idle = Math.max(0, days(today, last));
    const stage = (STAGES as readonly string[]).includes(s.stage ?? "") ? (s.stage as Stage) : null;
    return {
      id: s.id, name: s.name, region: s.region, stage, stage_label: stage ? STAGE_LABEL[stage] : null,
      start_date: s.start_date, end_date: s.end_date, lead_person_id: s.lead_person_id,
      lead_name: s.people ? s.people.nickname || s.people.name : null,
      headcount_need: s.headcount_need, deadline: s.deadline, days_to_deadline: s.deadline ? days(s.deadline, today) : null,
      flexible: s.flexible, risks: s.risks, open_issues: s.open_issues,
      upcoming_people_days: upcoming, pool_count: pool, last_activity: last, days_idle: idle,
      archived: !!s.archived_at, task_count: taskCount,
      stale: !s.archived_at && idle > STALE_DAYS, // 已結案的不需要提醒更新
    };
  });
  // 進行中的在前；近期有排班的在前；其次是久未更新的；最後依名稱
  return cards.sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) ||
      Number(b.upcoming_people_days > 0) - Number(a.upcoming_people_days > 0) ||
      Number(b.stale) - Number(a.stale) ||
      a.name.localeCompare(b.name, "zh-Hant"),
  );
}

// ---------------- 輸入驗證 ----------------
export interface SiteInput {
  name?: string;
  region: string | null;
  stage: Stage | null;
  start_date: string | null;
  end_date: string | null;
  lead_person_id: string | null;
  headcount_need: string | null;
  deadline: string | null;
  flexible: boolean;
  risks: string | null;
  open_issues: string | null;
}
export type Validated = { ok: true; value: SiteInput } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export function validateSiteInput(body: unknown, creating: boolean): Validated {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const text = (k: string, max: number, label: string): string | null | Error => {
    const v = b[k];
    if (v == null || v === "") return null;
    if (typeof v !== "string") return new Error(`${label}格式不對`);
    const t = v.trim();
    if (t.length > max) return new Error(`${label}最多 ${max} 個字`);
    return t || null;
  };
  const date = (k: string, label: string): string | null | Error => {
    const v = b[k];
    if (v == null || v === "") return null;
    return typeof v === "string" && validDate(v) ? v : new Error(`${label}日期不對`);
  };

  const name = text("name", 40, "案場名稱");
  if (name instanceof Error) return { ok: false, error: name.message };
  if (creating && !name) return { ok: false, error: "請填案場名稱" };

  const region = text("region", 40, "地區");
  const headcount = text("headcount_need", 60, "人力需求");
  const risks = text("risks", 1000, "風險");
  const issues = text("open_issues", 1000, "未解決事項");
  for (const v of [region, headcount, risks, issues]) if (v instanceof Error) return { ok: false, error: v.message };

  const start = date("start_date", "開始");
  const end = date("end_date", "結束");
  const deadline = date("deadline", "重要期限");
  for (const v of [start, end, deadline]) if (v instanceof Error) return { ok: false, error: v.message };
  if (typeof start === "string" && typeof end === "string" && end < start) return { ok: false, error: "結束日期不能早於開始日期" };

  const stageRaw = b.stage;
  if (stageRaw != null && stageRaw !== "" && !(STAGES as readonly string[]).includes(String(stageRaw))) return { ok: false, error: "階段不對" };

  const lead = b.lead_person_id;
  if (lead != null && lead !== "" && !(typeof lead === "string" && UUID.test(lead))) return { ok: false, error: "主責人員資料不對" };
  if (b.flexible != null && typeof b.flexible !== "boolean") return { ok: false, error: "是否可彈性資料不對" };

  return {
    ok: true,
    value: {
      ...(name ? { name } : {}),
      region: region as string | null,
      stage: stageRaw ? (String(stageRaw) as Stage) : null,
      start_date: start as string | null,
      end_date: end as string | null,
      lead_person_id: lead ? String(lead) : null,
      headcount_need: headcount as string | null,
      deadline: deadline as string | null,
      flexible: b.flexible === false ? false : true,
      risks: risks as string | null,
      open_issues: issues as string | null,
    },
  };
}
