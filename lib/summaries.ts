import { STATUS_LABEL, type FollowItem, type FollowView } from "./followups.js";
import type { TodayView } from "./today.js";

const MAX_PER_SECTION = 6;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

function followLine(i: FollowItem): string {
  const bits: string[] = [];
  if (i.urgent) bits.push("急");
  if (i.contact) bits.push(`對方：${i.contact}`);
  if (i.site) bits.push(i.site);
  if (i.overdue && i.days_to_due !== null) bits.push(`已逾期 ${-i.days_to_due} 天`);
  else if (i.due_date) bits.push(`期限 ${md(i.due_date)}`);
  if (i.waiting_days !== null) bits.push(i.waiting_days === 0 ? "今天開始等" : `已等 ${i.waiting_days} 天`);
  return `・${i.title}${bits.length ? `（${bits.join("，")}）` : ""}`;
}

/** 聊天室回答「我有什麼要回覆的？」：三個區塊，每區最多列 6 件 */
export function formatFollowups(v: FollowView): string {
  const total = v.to_reply.length + v.waiting_other.length + v.flexible_hold.length;
  if (!total) return "目前沒有要追蹤的事 👍\n（完整畫面請按選單「待我回覆」）";
  const section = (title: string, list: FollowItem[]) => {
    if (!list.length) return "";
    const shown = list.slice(0, MAX_PER_SECTION).map(followLine);
    if (list.length > MAX_PER_SECTION) shown.push(`…還有 ${list.length - MAX_PER_SECTION} 件`);
    return `【${title}（${list.length}）】\n${shown.join("\n")}`;
  };
  return [
    section(STATUS_LABEL.to_reply, v.to_reply),
    section(STATUS_LABEL.waiting_other, v.waiting_other),
    section(STATUS_LABEL.flexible_hold, v.flexible_hold),
    "完整畫面請按選單「待我回覆」。",
  ].filter(Boolean).join("\n\n");
}

/** 聊天室回答「今天有什麼工作？」 */
export function formatToday(v: TodayView, isToday: boolean): string {
  const head = `${md(v.date)}（${v.weekday}）${isToday ? "今天" : ""}`;
  const lines = v.groups.map((g) => {
    const time = g.start ? (g.end ? `${g.start}–${g.end}` : `${g.start} 起`) : "時間未定";
    const tail = [g.people.join("、"), g.vehicle, g.daily ? "點" : null].filter(Boolean).join("｜");
    return `・${time} ${g.title}${tail ? `（${tail}）` : ""}`;
  });
  const parts = [lines.length ? `${head}的工作：\n${lines.join("\n")}` : `${head}還沒有排定的工作。`];
  if (v.leaves.length) parts.push(`請假：${v.leaves.join("、")}`);
  parts.push("完整畫面請按選單「今日工作」。");
  return parts.join("\n\n");
}
