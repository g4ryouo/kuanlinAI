import { onBoard, type BoardPerson } from "./board.js";
import { dayInfo, holidayName } from "./holidays.js";
import { loadAround, suggestPeople, type PoolTask, type Suggestion } from "./suggest.js";

export interface PoolCard extends PoolTask {
  weekday: string | null;
  suggestion: Suggestion;
}

export interface AvailableDay {
  date: string;
  weekday: string;
  free: string[]; // 有空的內部人員
  outsourced: string[]; // 外包獨立顯示（未叫工）
  rest: boolean; // 假日（週末或國定假日）：出勤算點工
  demand: number; // 待排池在這天的人力需求
  shortage: number; // 缺幾人
}

const WD = ["日", "一", "二", "三", "四", "五", "六"];
const wdOf = (d: string) => WD[new Date(`${d}T00:00:00Z`).getUTCDay()];
const nameOf = (p: BoardPerson) => p.nickname || p.name;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const PRIORITY = { high: 0, normal: 1, low: 2 } as Record<string, number>;

export function shapePool(
  tasks: PoolTask[],
  people: BoardPerson[],
  busy: Set<string>,
  assignments: { person_id: string; work_date: string }[],
): PoolCard[] {
  return tasks
    .map((t) => ({
      ...t,
      weekday: t.wanted_date ? wdOf(t.wanted_date) : null,
      suggestion: suggestPeople(t, people, busy, t.wanted_date ? loadAround(assignments, t.wanted_date) : new Map()),
    }))
    .sort((a, b) => {
      if (a.wanted_date && b.wanted_date && a.wanted_date !== b.wanted_date) return a.wanted_date < b.wanted_date ? -1 : 1;
      if (!!a.wanted_date !== !!b.wanted_date) return a.wanted_date ? -1 : 1;
      return (PRIORITY[a.priority] ?? 1) - (PRIORITY[b.priority] ?? 1) || a.created_at.localeCompare(b.created_at);
    });
}

/** 今天起連續 days 天內的上班日：誰有空、外包、待排需求與缺口 */
export function shapeAvailable(
  today: string,
  days: number,
  people: BoardPerson[],
  busy: Set<string>,
  tasks: PoolTask[],
): AvailableDay[] {
  const board = people.filter(onBoard);
  const out: AvailableDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const rest = dayInfo(date).pay_mode === "daily";
    const demand = tasks.filter((t) => t.wanted_date === date).reduce((s, t) => s + (t.headcount && t.headcount > 0 ? t.headcount : 2), 0);
    if (rest && demand === 0) continue; // 假日沒有人要排就不列，避免畫面太雜
    const free = board.filter((p) => p.role !== "outsourced" && !busy.has(`${p.id}|${date}`) && !(rest && p.constraints?.avoid_weekend === true));
    const outsourced = board.filter((p) => p.role === "outsourced" && !busy.has(`${p.id}|${date}`)).map(nameOf);
    out.push({ date, weekday: wdOf(date), free: free.map(nameOf), outsourced, rest, demand, shortage: Math.max(0, demand - free.length) });
  }
  return out;
}

export { holidayName };
