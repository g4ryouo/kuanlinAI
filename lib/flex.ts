import type { LineMessage } from "./line.js";
import { VEHICLE_OPTIONS, headcountWarning, needsWork, timeText } from "./draft.js";
import { dayInfo } from "./holidays.js";
import type { Issue } from "./rules.js";
import { STATUS_LABEL } from "./followups.js";
import type { DraftItem, FollowUpDraft, LeaveNote } from "./types.js";

const FIELD_LABEL: Record<string, string> = {
  site: "案場", date: "日期", people: "人員", time_slot: "時段", work: "工作", vehicle: "車輛", headcount: "人數",
};

function row(label: string, value: string, warn = false) {
  return {
    type: "box", layout: "baseline", spacing: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: "#8a8f8c", flex: 2 },
      { type: "text", text: value, size: "sm", wrap: true, flex: 6, color: warn ? "#A02323" : "#1B2420" },
    ],
  };
}

/** 假日出勤算點工：紅底白字的「點」，之後薪資計算會用到 */
function dianRow() {
  return {
    type: "box", layout: "baseline", spacing: "sm",
    contents: [
      { type: "text", text: "計薪", size: "sm", color: "#8a8f8c", flex: 2 },
      {
        type: "box", layout: "horizontal", flex: 6,
        contents: [
          {
            type: "box", layout: "vertical", flex: 0, backgroundColor: "#C62828", cornerRadius: "4px", paddingAll: "2px", paddingStart: "8px", paddingEnd: "8px",
            contents: [{ type: "text", text: "點", color: "#FFFFFF", size: "xs", weight: "bold" }],
          },
          { type: "text", text: "假日出勤（點工）", size: "sm", color: "#5C6660", margin: "sm", flex: 1 },
        ],
      },
    ],
  };
}

function itemBox(it: DraftItem, issues: Issue[] = []) {
  const people = [
    ...(it.person_names ?? []),
    ...(it.unknown_people ?? []).map((n) => `${n}（待確認）`),
  ];
  const peopleText = people.length ? people.join("、") : "尚未指定（進待排池）";
  const notes = it.uncertain.map((f) => FIELD_LABEL[f] ?? f);
  const contents: unknown[] = [
    { type: "text", text: it.site ?? "案場待確認", weight: "bold", size: "md", color: it.site ? "#1B2420" : "#A02323", wrap: true },
    row("工作", needsWork(it) ? "內容待確認" : it.work, needsWork(it)),
    row("時間", timeText(it), !it.date),
    ...(it.date && dayInfo(it.date).pay_mode === "daily" ? [dianRow()] : []),
    row("人員", peopleText, !people.length || (it.unknown_people?.length ?? 0) > 0),
  ];
  if (it.vehicle) contents.push(row("車輛", `${it.vehicle}${it.vehicle_special ? "（特例，需冠璋同意）" : ""}`));
  if (it.headcount) contents.push(row("人力", `${it.headcount} 人`));
  const hc = headcountWarning(it);
  if (hc) contents.push(row("提醒", hc, true));
  for (const i of issues) {
    contents.push(i.level === "info" ? row("說明", i.text) : row(i.level === "block" ? "衝突" : "提醒", i.text, true));
  }
  if (notes.length) contents.push(row("待確認", notes.join("、"), true));
  return { type: "box", layout: "vertical", spacing: "sm", margin: "lg", contents };
}

export function leaveText(leaves: LeaveNote[]): string {
  const parts = leaves.map((l) => `${l.person_name ?? `${l.person}（待確認）`} ${l.date ?? "日期待確認"}`);
  return `偵測到請假：${parts.join("、")}。請假以請假表為準，這裡不會寫入。`;
}

export function confirmCard(draftId: string, items: DraftItem[], leaves: LeaveNote[] = [], issues: Issue[][] = []): LineMessage {
  const btn = (label: string, data: string, primary = false) => ({
    type: "button", style: primary ? "primary" : "secondary", height: "sm",
    action: { type: "postback", label, data, displayText: label },
  });
  return {
    type: "flex",
    altText: `確認新增 ${items.length} 項工作`,
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", contents: [{ type: "text", text: "請確認這些工作", weight: "bold", size: "lg" }] },
      body: {
        type: "box", layout: "vertical",
        contents: [
          ...items.map((it, i) => itemBox(it, issues[i] ?? [])),
          ...(leaves.length
            ? [{ type: "box", layout: "vertical", margin: "lg", contents: [{ type: "text", text: leaveText(leaves), size: "xs", color: "#5C6660", wrap: true }] }]
            : []),
        ],
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          btn("確認新增", `a=confirm&d=${draftId}`, true),
          btn("改派人員", `a=reassign&d=${draftId}`),
          btn("選擇車輛", `a=vehicle&d=${draftId}`),
          btn("稍後處理", `a=later&d=${draftId}`),
        ],
      },
    },
  };
}

/** CR-V 以冠璋為主：只有冠璋在人員名單時才出現「CR-V」；其他人只會看到「CR-V（特例）」 */
export function vehicleQuickReply(draftId: string, bossAssigned: boolean): LineMessage {
  const options = VEHICLE_OPTIONS.filter((o) => (o.code === "c" ? bossAssigned : o.code === "s" ? !bossAssigned : true));
  return {
    type: "text",
    text: bossAssigned ? "要用哪一輛車？" : "要用哪一輛車？CR-V 以冠璋為主，其他人使用請選「CR-V（特例）」。",
    quickReply: {
      items: options.map((o) => ({
        type: "action",
        action: { type: "postback", label: o.label, data: `a=veh&d=${draftId}&v=${o.code}`, displayText: o.label },
      })),
    },
  };
}

export const MAX_PICK = 6; // postback data 上限 300 字元，6 人以內安全

export const compactId = (id: string) => id.replace(/-/g, "");
export const expandId = (c: string) => c.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

/** 改派：可連續選人，選到的人編在 postback 的 s 欄位裡，不需要後端暫存 */
export function reassignQuickReply(
  draftId: string,
  people: { id: string; name: string }[],
  selected: { id: string; name: string }[] = [],
): LineMessage {
  const sel = selected.map((p) => compactId(p.id)).join(",");
  const picked = new Set(selected.map((p) => p.id));
  const canAdd = selected.length < MAX_PICK;
  const items: unknown[] = canAdd
    ? people
        .filter((p) => !picked.has(p.id))
        .slice(0, selected.length ? 12 : 13)
        .map((p) => ({
          type: "action",
          action: {
            type: "postback",
            label: p.name.slice(0, 20),
            data: `a=pick&d=${draftId}&s=${sel}&p=${compactId(p.id)}`,
            displayText: p.name,
          },
        }))
    : [];
  if (selected.length) {
    items.push({
      type: "action",
      action: { type: "postback", label: "完成", data: `a=done&d=${draftId}&s=${sel}`, displayText: "完成" },
    });
  }
  return {
    type: "text",
    text: selected.length
      ? `已選：${selected.map((p) => p.name).join("、")}。還要加人嗎？選完請按「完成」。`
      : "要改派給誰？可以連續加人，選完按「完成」。",
    quickReply: { items },
  };
}

export function parsePostback(data: string): { a: string; d: string; p?: string; s?: string; v?: string } | null {
  const q = new URLSearchParams(data);
  const a = q.get("a");
  const d = q.get("d");
  if (!a || !d) return null;
  return { a, d, p: q.get("p") ?? undefined, s: q.get("s") ?? undefined, v: q.get("v") ?? undefined };
}

/** 聊天室判斷出「要追蹤的事」：確認後才加進「待我回覆」 */
export function followCard(draftId: string, items: FollowUpDraft[]): LineMessage {
  const box = (it: FollowUpDraft) => ({
    type: "box", layout: "vertical", spacing: "sm", margin: "lg",
    contents: [
      { type: "text", text: it.title, weight: "bold", size: "md", wrap: true },
      row("狀態", `${STATUS_LABEL[it.status]}${it.urgent ? "（急）" : ""}`, it.urgent),
      ...(it.contact ? [row("對方", it.contact)] : []),
      ...(it.site ? [row("案場", it.site)] : []),
      ...(it.due_date ? [row("期限", it.due_date)] : []),
    ],
  });
  const btn = (label: string, data: string, primary = false) => ({
    type: "button", style: primary ? "primary" : "secondary", height: "sm",
    action: { type: "postback", label, data, displayText: label },
  });
  return {
    type: "flex",
    altText: `要加入追蹤嗎？${items.map((i) => i.title).join("、")}`,
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", contents: [{ type: "text", text: "要加入追蹤嗎？", weight: "bold", size: "lg" }] },
      body: { type: "box", layout: "vertical", contents: items.map(box) },
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: [btn("加入追蹤", `a=fconfirm&d=${draftId}`, true), btn("不用了", `a=fskip&d=${draftId}`)] },
    },
  };
}
