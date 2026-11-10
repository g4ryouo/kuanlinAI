import { isRestDay } from "./holidays.js";
import type { FollowItem, FollowView } from "./followups.js";
import type { LineMessage } from "./line.js";
import type { TodayView } from "./today.js";

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const MAX_LINES = 5;

export interface BriefInput {
  today: string;
  todayView: TodayView;
  follow: FollowView;
  poolCount: number;
  liffId?: string;
}
export interface Brief {
  text: string;
  flex: LineMessage;
  hasContent: boolean;
}

/** 要特別提醒的追蹤事項：急件、已逾期、等超過 3 天 */
export function needsAttention(i: FollowItem): boolean {
  return i.urgent || i.overdue || i.wait_warn;
}

function attentionLine(i: FollowItem): string {
  const tags: string[] = [];
  if (i.urgent) tags.push("急");
  if (i.overdue && i.days_to_due !== null) tags.push(`已逾期 ${-i.days_to_due} 天`);
  else if (i.due_date && i.days_to_due !== null && i.days_to_due <= 1) tags.push(i.days_to_due === 0 ? "今天到期" : "明天到期");
  if (i.waiting_days !== null && i.wait_warn) tags.push(`已等 ${i.waiting_days} 天`);
  if (i.contact) tags.push(`對方：${i.contact}`);
  return `・${i.title}${tags.length ? `（${tags.join("，")}）` : ""}`;
}

/** 假日（週末、國定假日）如果沒有排班也沒有要緊的事，就不吵人 */
export function shouldSendBrief(today: string, v: TodayView, follow: FollowView): boolean {
  if (!isRestDay(today)) return true;
  return v.groups.length > 0 || [...follow.to_reply, ...follow.waiting_other, ...follow.flexible_hold].some(needsAttention);
}

export function buildBrief(input: BriefInput): Brief {
  const { todayView: v, follow } = input;
  const title = `早安！今天 ${md(v.date)}（${v.weekday}）`;

  // 今日工作
  const work = v.groups.slice(0, MAX_LINES).map((g) => {
    const time = g.start ? (g.end ? `${g.start}–${g.end}` : `${g.start} 起`) : "時間未定";
    const tail = [g.people.join("、"), g.vehicle, g.daily ? "點" : null].filter(Boolean).join("｜");
    return `・${time} ${g.title}${tail ? `（${tail}）` : ""}`;
  });
  if (v.groups.length > MAX_LINES) work.push(`…還有 ${v.groups.length - MAX_LINES} 件`);

  // 要你處理的事
  const attention = follow.to_reply.filter(needsAttention);
  const waitingLong = follow.waiting_other.filter(needsAttention);
  const hold = follow.flexible_hold;
  const reply = attention.slice(0, MAX_LINES).map(attentionLine);
  if (attention.length > MAX_LINES) reply.push(`…還有 ${attention.length - MAX_LINES} 件`);
  const others = follow.to_reply.length - attention.length;

  const sections: { head: string; lines: string[] }[] = [];
  sections.push({ head: work.length ? `今天的工作（${v.groups.length}）` : "今天的工作", lines: work.length ? work : ["今天還沒有排定的工作"] });
  if (v.leaves.length) sections.push({ head: "請假", lines: [v.leaves.join("、")] });
  if (reply.length || others > 0) {
    sections.push({ head: `待我回覆（${follow.to_reply.length}）`, lines: [...reply, ...(others > 0 ? [`另有 ${others} 件一般待回覆`] : [])] });
  }
  if (waitingLong.length) sections.push({ head: "等對方太久了", lines: waitingLong.slice(0, MAX_LINES).map(attentionLine) });
  if (hold.length) sections.push({ head: `機動保留（${hold.length}）`, lines: hold.slice(0, MAX_LINES).map((i) => `・${i.title}${i.due_date ? `（期限 ${md(i.due_date)}）` : ""}`) });
  if (input.poolCount > 0) sections.push({ head: "待排工作", lines: [`${input.poolCount} 件還沒決定派誰`] });

  const text = [title, ...sections.map((s) => `【${s.head}】\n${s.lines.join("\n")}`)].join("\n\n");

  const buttons = input.liffId
    ? [
        { label: "看今日排程", uri: `https://liff.line.me/${input.liffId}/today`, primary: true },
        { label: "待我回覆", uri: `https://liff.line.me/${input.liffId}/follow`, primary: false },
      ]
    : [];
  const flex: LineMessage = {
    type: "flex",
    altText: `${title}｜今天 ${v.groups.length} 件工作`,
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", contents: [{ type: "text", text: title, weight: "bold", size: "lg", wrap: true }] },
      body: {
        type: "box", layout: "vertical", spacing: "lg",
        contents: sections.map((s) => ({
          type: "box", layout: "vertical", spacing: "xs",
          contents: [
            { type: "text", text: s.head, weight: "bold", size: "sm", color: "#5C6660" },
            ...s.lines.map((l) => ({ type: "text", text: l, size: "sm", wrap: true })),
          ],
        })),
      },
      ...(buttons.length
        ? {
            footer: {
              type: "box", layout: "vertical", spacing: "sm",
              contents: buttons.map((b) => ({
                type: "button", style: b.primary ? "primary" : "secondary", height: "sm",
                action: { type: "uri", label: b.label, uri: b.uri },
              })),
            },
          }
        : {}),
    },
  };
  return { text, flex, hasContent: v.groups.length > 0 || attention.length > 0 || waitingLong.length > 0 || hold.length > 0 };
}

/** 簡報收件人：BRIEF_USER_IDS（逗號分隔）有設就用它，否則用白名單 */
export function pickRecipients(briefIds: string, allowed: Set<string>): string[] {
  const ids = briefIds.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length ? [...new Set(ids)] : [...allowed];
}

/** 防止同一天重複推播；resend 時加上時間戳，專門給手動重送測試用 */
export function dedupeKey(today: string, userId: string, resendAt?: number): string {
  return `morning:${today}:${userId}${resendAt ? `:${resendAt}` : ""}`;
}
