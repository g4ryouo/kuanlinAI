export interface AssignmentRow {
  task_id: string | null;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  kind: string;
  people: { name: string } | null;
  vehicles: { name: string } | null;
  tasks: { title: string; sites: { name: string } | null } | null;
}

export interface TodayGroup {
  title: string;
  site: string | null;
  kind: string;
  kind_label: string;
  start: string | null;
  end: string | null;
  vehicle: string | null;
  people: string[];
}

export interface TodayView {
  date: string;
  weekday: string;
  groups: TodayGroup[];
  leaves: string[];
}

const KIND: Record<string, string> = { S: "施工", R: "維修", V: "場勘／會議", P: "待排", C: "已完成", N: "未叫工" };
const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

export function weekdayOf(date: string): string {
  return WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** 同一件工作、同一時段、同一輛車的多位人員合成一張卡片 */
export function shapeToday(date: string, rows: AssignmentRow[], leaveNames: string[]): TodayView {
  const map = new Map<string, TodayGroup>();
  for (const r of rows) {
    const start = hhmm(r.start_time);
    const end = hhmm(r.end_time);
    const vehicle = r.vehicles?.name ?? null;
    const key = [r.task_id ?? `solo-${r.people?.name ?? ""}`, start, end, vehicle].join("|");
    let g = map.get(key);
    if (!g) {
      g = {
        title: r.tasks?.title ?? "（未命名工作）",
        site: r.tasks?.sites?.name ?? null,
        kind: r.kind,
        kind_label: KIND[r.kind] ?? r.kind,
        start,
        end,
        vehicle,
        people: [],
      };
      map.set(key, g);
    }
    const name = r.people?.name;
    if (name && !g.people.includes(name)) g.people.push(name);
  }
  const groups = [...map.values()].sort((a, b) => {
    if (a.start && b.start && a.start !== b.start) return a.start < b.start ? -1 : 1;
    if (!!a.start !== !!b.start) return a.start ? -1 : 1; // 有時間的排前面
    return a.title.localeCompare(b.title, "zh-Hant");
  });
  return { date, weekday: weekdayOf(date), groups, leaves: [...new Set(leaveNames)] };
}
