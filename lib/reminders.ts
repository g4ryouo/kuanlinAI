import { flexCard, needsAttention } from "./brief.js";
import { holidayName, isRestDay } from "./holidays.js";
import type { FollowView } from "./followups.js";
import type { LineMessage } from "./line.js";
import type { TodayView } from "./today.js";

export type ReminderKind = "morning" | "arrive" | "done" | "evening";
export const KINDS: ReminderKind[] = ["morning", "arrive", "done", "evening"];

export interface Reminder {
  /** 這則提醒要不要送（沒有內容就安靜） */
  send: boolean;
  skipReason?: string;
  text: string;
  flex: LineMessage;
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const MAX = 5;

export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function jobLines(v: TodayView): string[] {
  const lines = v.groups.slice(0, MAX).map((g) => {
    const time = g.start ? (g.end ? `${g.start}–${g.end}` : `${g.start} 起`) : "時間未定";
    const tail = [g.people.join("、"), g.vehicle, g.daily ? "點" : null].filter(Boolean).join("｜");
    return `・${time} ${g.title}${tail ? `（${tail}）` : ""}`;
  });
  if (v.groups.length > MAX) lines.push(`…還有 ${v.groups.length - MAX} 件`);
  return lines;
}

const toText = (title: string, sections: { head: string; lines: string[] }[]) =>
  [title, ...sections.map((s) => `【${s.head}】\n${s.lines.join("\n")}`)].join("\n\n");

/** 10:00 抵達確認：今天有排班才提醒 */
export function buildArrive(input: { todayView: TodayView; liffId?: string }): Reminder {
  const v = input.todayView;
  const title = "10:00 抵達確認";
  const sections = [
    { head: `今天的工作（${v.groups.length}）`, lines: jobLines(v) },
    { head: "請確認", lines: ["現場人員都到了嗎？有延誤或變動，直接傳訊息告訴我。"] },
  ];
  return {
    send: v.groups.length > 0,
    skipReason: v.groups.length ? undefined : "今天沒有排班",
    text: toText(title, sections),
    flex: flexCard(title, sections, input.liffId, [{ label: "看今日排程", path: "today", primary: true }]),
  };
}

/** 16:00 完工確認：今天有排班才提醒；機動待辦今天到期或已逾期的一併列出（要做決定） */
export function buildDone(input: { todayView: TodayView; follow: FollowView; liffId?: string }): Reminder {
  const v = input.todayView;
  const decide = input.follow.flexible_hold.filter((i) => i.overdue || i.days_to_due === 0 || i.urgent);
  const title = "16:00 完工確認";
  const sections = [{ head: `今天的工作（${v.groups.length}）`, lines: v.groups.length ? jobLines(v) : ["今天沒有排班"] }];
  sections.push({ head: "請確認", lines: ["今天的工作都完成了嗎？沒完成的請告訴我，我幫你調整。"] });
  if (decide.length) {
    sections.push({
      head: "機動待辦，今天要決定",
      lines: decide.slice(0, MAX).map((i) => `・${i.title}${i.overdue && i.days_to_due !== null ? `（已逾期 ${-i.days_to_due} 天）` : i.due_date ? "（今天到期）" : ""}`),
    });
  }
  const send = v.groups.length > 0 || decide.length > 0;
  return {
    send,
    skipReason: send ? undefined : "今天沒有排班，也沒有要決定的機動待辦",
    text: toText(title, sections),
    flex: flexCard(title, sections, input.liffId, [
      { label: "看今日排程", path: "today", primary: true },
      { label: "待我回覆", path: "follow", primary: false },
    ]),
  };
}

/** 20:00 明日預覽與待處理 */
export function buildEvening(input: {
  tomorrow: string;
  tomorrowView: TodayView;
  follow: FollowView;
  unassignedTomorrow: string[]; // 想排在明天、還沒決定派誰的工作標題
  liffId?: string;
}): Reminder {
  const v = input.tomorrowView;
  const restName = isRestDay(input.tomorrow) ? holidayName(input.tomorrow) ?? "週末" : null;
  const title = `20:00 明日預覽：${md(input.tomorrow)}（${v.weekday}）`;
  const sections: { head: string; lines: string[] }[] = [];

  sections.push({
    head: `明天的工作（${v.groups.length}）`,
    lines: v.groups.length ? jobLines(v) : [restName ? `明天是${restName}，沒有排班` : "明天還沒有排定的工作"],
  });
  if (v.leaves.length) sections.push({ head: "明天請假", lines: [v.leaves.join("、")] });
  if (input.unassignedTomorrow.length) {
    sections.push({
      head: "明天還沒排人的工作",
      lines: [...input.unassignedTomorrow.slice(0, MAX).map((t) => `・${t}`), ...(input.unassignedTomorrow.length > MAX ? [`…還有 ${input.unassignedTomorrow.length - MAX} 件`] : [])],
    });
  }

  const f = input.follow;
  const attention = [...f.to_reply, ...f.waiting_other, ...f.flexible_hold].filter(needsAttention);
  const open = f.to_reply.length + f.waiting_other.length + f.flexible_hold.length;
  if (open) {
    const lines = [`待我回覆 ${f.to_reply.length} 件、等對方回覆 ${f.waiting_other.length} 件、機動待辦 ${f.flexible_hold.length} 件`];
    if (attention.length) lines.push(`其中 ${attention.length} 件是急件、已逾期或等太久：${attention.slice(0, 3).map((i) => i.title).join("、")}${attention.length > 3 ? "…" : ""}`);
    sections.push({ head: "還沒處理的事", lines });
  }

  const quiet = !!restName && v.groups.length === 0 && !v.leaves.length && !input.unassignedTomorrow.length && attention.length === 0;
  return {
    send: !quiet,
    skipReason: quiet ? `明天是${restName}，沒有排班也沒有要緊的事` : undefined,
    text: toText(title, sections),
    flex: flexCard(title, sections, input.liffId, [
      { label: "人力排班", path: "board", primary: true },
      { label: "待我回覆", path: "follow", primary: false },
    ]),
  };
}
