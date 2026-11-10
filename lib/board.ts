export type Code = "S" | "R" | "V" | "P" | "L" | "X" | "C" | "N" | "-" | "";

export interface BoardPerson {
  id: string;
  name: string;
  nickname: string | null;
  role: string;
  active: boolean;
  sort_order: number;
  constraints: Record<string, unknown> | null;
}

export interface BoardAssignment {
  person_id: string;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  kind: string;
  vehicles: { name: string } | null;
  tasks: { title: string; sites: { name: string } | null } | null;
}

export interface CellItem {
  title: string;
  site: string | null;
  start: string | null;
  end: string | null;
  vehicle: string | null;
  kind: string;
}
export interface Cell {
  code: Code;
  items: CellItem[];
  note?: string;
}
export interface BoardDay {
  date: string;
  weekday: string;
  weekend: boolean;
  today: boolean;
}
export interface BoardRow {
  id: string;
  name: string;
  sub: string;
  cells: Cell[];
}
export interface BoardView {
  view: "week" | "month";
  from: string;
  to: string;
  label: string;
  days: BoardDay[];
  rows: BoardRow[];
  summary: { date: string; pending: number; conflicts: number }[];
}

const DAY = 86_400_000;
const WD = ["日", "一", "二", "三", "四", "五", "六"];
const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
const toMin = (t: string | null) => {
  const m = t ? /^(\d{1,2}):(\d{2})/.exec(t) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** 週以週一為起點；月為當月 1 日到月底 */
export function rangeFor(view: "week" | "month", anchor: string): { from: string; to: string; label: string } {
  const t = ms(anchor);
  if (view === "week") {
    const dow = new Date(t).getUTCDay(); // 0=日
    const from = t - ((dow + 6) % 7) * DAY;
    const to = from + 6 * DAY;
    const md = (t: number) => `${new Date(t).getUTCMonth() + 1}/${new Date(t).getUTCDate()}`;
    return { from: toIso(from), to: toIso(to), label: `${md(from)}–${md(to)}` };
  }
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const from = Date.UTC(y, m, 1);
  const to = Date.UTC(y, m + 1, 0);
  return { from: toIso(from), to: toIso(to), label: `${y} 年 ${m + 1} 月` };
}

export function listDays(from: string, to: string, today: string): BoardDay[] {
  const out: BoardDay[] = [];
  for (let t = ms(from); t <= ms(to) && out.length < 42; t += DAY) {
    const d = new Date(t);
    const wd = d.getUTCDay();
    const date = toIso(t);
    out.push({ date, weekday: WD[wd], weekend: wd === 0 || wd === 6, today: date === today });
  }
  return out;
}

/** 左欄的小字：老闆、助手、點工、外包團隊人數 */
function subtitle(p: BoardPerson): string {
  const c = p.constraints ?? {};
  if (p.role === "owner") return "老闆";
  if (typeof c.team_size === "number") return `${c.team_size} 人·外包`;
  if (c.daily_hire === true) return "點工";
  if (c.no_solo === true) return "助手";
  return "";
}

/** 人員要不要出現在人力表：老闆、現場、外包；排除行政、已停用、很少到現場的人 */
export function onBoard(p: BoardPerson): boolean {
  if (!p.active) return false;
  if (!["owner", "field", "outsourced"].includes(p.role)) return false;
  return (p.constraints ?? {}).rarely_on_site !== true;
}

function overlapAny(items: CellItem[]): boolean {
  const spans = items
    .map((i) => [toMin(i.start), toMin(i.end)] as const)
    .filter((s): s is readonly [number, number] => s[0] !== null && s[1] !== null && s[0] < s[1]);
  for (let i = 0; i < spans.length; i++)
    for (let j = i + 1; j < spans.length; j++) if (spans[i][0] < spans[j][1] && spans[j][0] < spans[i][1]) return true;
  return false;
}

export function shapeBoard(
  view: "week" | "month",
  anchor: string,
  today: string,
  peopleAll: BoardPerson[],
  assignments: BoardAssignment[],
  leaves: { person_id: string; leave_date: string }[],
): BoardView {
  const range = rangeFor(view, anchor);
  const days = listDays(range.from, range.to, today);
  const people = peopleAll.filter(onBoard).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-Hant"));
  const leaveSet = new Set(leaves.map((l) => `${l.person_id}|${l.leave_date}`));

  const byKey = new Map<string, BoardAssignment[]>();
  for (const a of assignments) {
    const k = `${a.person_id}|${a.work_date}`;
    byKey.set(k, [...(byKey.get(k) ?? []), a]);
  }

  const rows: BoardRow[] = people.map((p) => {
    const cells: Cell[] = days.map((d) => {
      const list = (byKey.get(`${p.id}|${d.date}`) ?? []).slice().sort((a, b) => (a.start_time ?? "99").localeCompare(b.start_time ?? "99"));
      const items: CellItem[] = list.map((a) => ({
        title: a.tasks?.title ?? "（未命名工作）",
        site: a.tasks?.sites?.name ?? null,
        start: hhmm(a.start_time),
        end: hhmm(a.end_time),
        vehicle: a.vehicles?.name ?? null,
        kind: a.kind,
      }));
      const onLeave = leaveSet.has(`${p.id}|${d.date}`);
      if (items.length) {
        if (onLeave) return { code: "X", items, note: "這天已核准請假，但仍有排班，請調整" };
        if (overlapAny(items)) return { code: "X", items, note: "同一天的工作時間重疊，請調整" };
        if (d.date < today) return { code: "C", items };
        const k = items[0].kind;
        return { code: (["S", "R", "V"].includes(k) ? k : "S") as Code, items };
      }
      if (onLeave) return { code: "L", items: [], note: "請假（來自請假表）" };
      if (d.weekend) return { code: "-", items: [] };
      if (d.date < today) return { code: "", items: [] };
      return p.role === "outsourced"
        ? { code: "N", items: [], note: "點工或外包，尚未叫工" }
        : { code: "P", items: [], note: "這天還沒有排工作" };
    });
    return { id: p.id, name: p.nickname || p.name, sub: subtitle(p), cells };
  });

  const summary = days.map((d, i) => ({
    date: d.date,
    pending: rows.filter((r) => r.cells[i].code === "P").length,
    conflicts: rows.filter((r) => r.cells[i].code === "X").length,
  }));

  return { view, from: range.from, to: range.to, label: range.label, days, rows, summary };
}
