import { onBoard, type BoardPerson } from "./board.js";
import { dayInfo } from "./holidays.js";

export interface PoolTask {
  id: string;
  title: string;
  work: string | null;
  site: string | null;
  priority: string;
  wanted_date: string | null;
  headcount: number | null;
  start_time: string | null;
  end_time: string | null;
  created_at: string;
}

export interface Suggestion {
  ids: string[];
  names: string[];
  warnings: string[];
  reason: string;
  /** 假日出勤，會標註為點工 */
  daily: boolean;
}

const WATER = /水電|給排水|排水|給水|水管|配管/;
const LOW_VOLTAGE = /弱電|監視|網路|攝影|門禁|對講/;
const SURVEY = /場勘|會議|報價|勘查/;
const DELIVERY = /送貨|送料/;

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const nameOf = (p: BoardPerson) => p.nickname || p.name;
const empty = (reason: string, daily = false): Suggestion => ({ ids: [], names: [], warnings: [], reason, daily });

/** 某人在某日前後各 3 天的排班件數，用來讓工作量盡量平均 */
export function loadAround(assignments: { person_id: string; work_date: string }[], date: string): Map<string, number> {
  const t = Date.parse(`${date}T00:00:00Z`);
  const m = new Map<string, number>();
  for (const a of assignments) {
    if (Math.abs(Date.parse(`${a.work_date}T00:00:00Z`) - t) <= 3 * 86_400_000) m.set(a.person_id, (m.get(a.person_id) ?? 0) + 1);
  }
  return m;
}

/**
 * 規則式建議人選（不是 AI 猜的，可預期、可測試）：
 * 只挑那天有空的人；休息日（週末、國定假日）不排；請假的人已在 busy 內被排除。
 * 水電優先阿鎮；場勘會議先看冠璋；阿盛不單獨出勤；人力不夠時，弱電工作才補阿澤（需叫工）。
 */
export function suggestPeople(
  task: Pick<PoolTask, "title" | "work" | "wanted_date" | "headcount">,
  people: BoardPerson[],
  busy: Set<string>, // `${personId}|${date}`：那天已有排班或請假
  load: Map<string, number>,
): Suggestion {
  const date = task.wanted_date;
  if (!date) return empty("日期還沒定，請先在聊天室補上日期");
  const daily = dayInfo(date).pay_mode === "daily";

  const text = `${task.work ?? ""} ${task.title}`;
  const need = task.headcount && task.headcount > 0 ? task.headcount : 2;
  const free = people
    .filter(onBoard)
    .filter((p) => !busy.has(`${p.id}|${date}`))
    .filter((p) => !(daily && p.constraints?.avoid_weekend === true)); // 阿杰假日原則不排
  const byLoad = (a: BoardPerson, b: BoardPerson) =>
    (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-Hant");

  const done = (picks: BoardPerson[], reason: string, extra: string[] = []): Suggestion => {
    const warnings = [...extra];
    if (picks.length < need) warnings.push(`人力不足：需要 ${need} 人，只找到 ${picks.length} 人`);
    const solo = picks.length === 1 && !DELIVERY.test(text);
    const p = picks[0];
    const exempt = p && (Number(p.constraints?.team_size ?? 1) >= 2 || (p.constraints?.solo_low_voltage === true && LOW_VOLTAGE.test(text)));
    if (solo && !exempt && picks.length >= need) warnings.push("只有 1 人，施工／維修建議至少 2 人");
    return { ids: picks.map((x) => x.id), names: picks.map(nameOf), warnings, reason: daily ? `${reason}（假日出勤，算點工）` : reason, daily };
  };

  // 水電：優先阿鎮（外包團隊算一個單位）
  if (WATER.test(text)) {
    const team = free.find((p) => p.name === "阿鎮" && p.role === "outsourced");
    if (team) return done([team], "水電相關工作，優先排給阿鎮");
  }

  const picks: BoardPerson[] = [];
  const owner = free.find((p) => p.role === "owner");
  if (SURVEY.test(text) && owner) picks.push(owner);

  const field = free.filter((p) => p.role === "field" && p.constraints?.no_solo !== true).sort(byLoad);
  for (const p of field) {
    if (picks.length >= need) break;
    picks.push(p);
  }
  // 阿盛不能單獨出勤：至少要有另一個人在才補上
  const helper = free.find((p) => p.role === "field" && p.constraints?.no_solo === true);
  if (helper && picks.length >= 1 && picks.length < need) picks.push(helper);

  const warnings: string[] = [];
  if (picks.length < need && LOW_VOLTAGE.test(text)) {
    const hire = free.find((p) => p.role === "outsourced" && p.constraints?.daily_hire === true);
    if (hire) {
      picks.push(hire);
      warnings.push(`${nameOf(hire)}是點工，需要叫工`);
    }
  }
  if (!picks.length) return empty(`${md(date)} 沒有有空的人`, daily);
  return done(picks, `${md(date)} 有空、本週負擔較少的人`, warnings);
}
