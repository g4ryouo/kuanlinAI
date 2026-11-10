import type { LineMessage } from "./line.js";
import { headcountWarning, needsWork } from "./draft.js";
import type { Issue } from "./rules.js";
import type { DraftItem, LeaveNote } from "./types.js";

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
    row("時間", [it.date ?? "日期待確認", it.time_slot].filter(Boolean).join(" "), !it.date),
    row("人員", peopleText, !people.length || (it.unknown_people?.length ?? 0) > 0),
  ];
  if (it.vehicle) contents.push(row("車輛", it.vehicle));
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
          btn("稍後處理", `a=later&d=${draftId}`),
        ],
      },
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

export function parsePostback(data: string): { a: string; d: string; p?: string; s?: string } | null {
  const q = new URLSearchParams(data);
  const a = q.get("a");
  const d = q.get("d");
  if (!a || !d) return null;
  return { a, d, p: q.get("p") ?? undefined, s: q.get("s") ?? undefined };
}
