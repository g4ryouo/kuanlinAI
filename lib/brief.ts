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

type Section = { head: string; lines: string[] };
type Btn = { label: string; path: string; primary: boolean };

/** 共用的提醒卡片：標題、幾個區塊、底下最多兩顆開 LIFF 的按鈕（LIFF ID 沒設就不放按鈕，避免壞連結） */
export function flexCard(title: string, sections: Section[], liffId: string | undefined, buttons: Btn[]): LineMessage {
  const real = liffId ? buttons.map((b) => ({ ...b, uri: `https://liff.line.me/${liffId}/${b.path}` })) : [];
  return {
    type: "flex",
    altText: `${title}｜${sections[0]?.lines[0] ?? ""}`.slice(0, 380),
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
      ...(real.length
        ? {
            footer: {
              type: "box", layout: "vertical", spacing: "sm",
              contents: real.map((b) => ({ type: "button", style: b.primary ? "primary" : "secondary", height: "sm", action: { type: "uri", label: b.label, uri: b.uri } })),
            },
          }
        : {}),
    },
  };
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

  const sections: Section[] = [];
  sections.push({ head: work.length ? `今天的工作（${v.groups.length}）` : "今天的工作", lines: work.length ? work : ["今天還沒有排定的工作"] });
  if (v.leaves.length) sections.push({ head: "請假", lines: [v.leaves.join("、")] });
  if (reply.length || others > 0) {
    sections.push({ head: `待我回覆（${follow.to_reply.length}）`, lines: [...reply, ...(others > 0 ? [`另有 ${others} 件一般待回覆`] : [])] });
  }
  if (waitingLong.length) sections.push({ head: "等對方太久了", lines: waitingLong.slice(0, MAX_LINES).map(attentionLine) });
  if (hold.length) sections.push({ head: `機動保留（${hold.length}）`, lines: hold.slice(0, MAX_LINES).map((i) => `・${i.title}${i.due_date ? `（期限 ${md(i.due_date)}）` : ""}`) });
  if (input.poolCount > 0) sections.push({ head: "待排工作", lines: [`${input.poolCount} 件還沒決定派誰`] });

  const text = [title, ...sections.map((s) => `【${s.head}】\n${s.lines.join("\n")}`)].join("\n\n");

  const flex = flexCard(title, sections, input.liffId, [
    { label: "看今日排程", path: "today", primary: true },
    { label: "待我回覆", path: "follow", primary: false },
  ]);
  return { text, flex, hasContent: v.groups.length > 0 || attention.length > 0 || waitingLong.length > 0 || hold.length > 0 };
}

/**
 * 提醒收件人：先看 BRIEF_USER_IDS（逗號分隔的 LINE userId），沒設就用資料庫裡老闆（role = owner）的 line_user_id。
 * 兩者都沒有就回傳空陣列＝不推播（寧可不送，也不要送錯人）。
 */
export function pickRecipients(briefIds: string, ownerIds: string[]): string[] {
  const ids = briefIds.split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set(ids.length ? ids : ownerIds.filter(Boolean))];
}

/** 防止同一天同一個人重複推播；resend 時加上時間戳，專門給手動重送測試用 */
export function dedupeKey(today: string, userId: string, resendAt?: number, kind = "morning"): string {
  return `${kind}:${today}:${userId}${resendAt ? `:${resendAt}` : ""}`;
}
