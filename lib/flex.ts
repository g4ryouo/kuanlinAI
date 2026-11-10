import type { LineMessage } from "./line.js";
import type { DraftItem } from "./types.js";

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

function itemBox(it: DraftItem) {
  const people = [
    ...(it.person_names ?? []),
    ...(it.unknown_people ?? []).map((n) => `${n}（待確認）`),
  ];
  const peopleText = people.length ? people.join("、") : "尚未指定（進待排池）";
  const notes = it.uncertain.map((f) => FIELD_LABEL[f] ?? f);
  const contents: unknown[] = [
    { type: "text", text: it.site ?? "案場待確認", weight: "bold", size: "md", color: it.site ? "#1B2420" : "#A02323", wrap: true },
    row("工作", it.work),
    row("時間", [it.date ?? "日期待確認", it.time_slot].filter(Boolean).join(" "), !it.date),
    row("人員", peopleText, !people.length || (it.unknown_people?.length ?? 0) > 0),
  ];
  if (it.vehicle) contents.push(row("車輛", it.vehicle));
  if (it.headcount) contents.push(row("人力", `${it.headcount} 人`));
  if (notes.length) contents.push(row("待確認", notes.join("、"), true));
  return { type: "box", layout: "vertical", spacing: "sm", margin: "lg", contents };
}

export function confirmCard(draftId: string, items: DraftItem[]): LineMessage {
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
      body: { type: "box", layout: "vertical", contents: items.map(itemBox) },
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

export function reassignQuickReply(
  draftId: string,
  people: { id: string; name: string }[],
): LineMessage {
  return {
    type: "text",
    text: "要改派給誰？",
    quickReply: {
      items: people.slice(0, 13).map((p) => ({
        type: "action",
        action: { type: "postback", label: p.name.slice(0, 20), data: `a=assign&d=${draftId}&p=${p.id}`, displayText: p.name },
      })),
    },
  };
}

export function parsePostback(data: string): { a: string; d: string; p?: string } | null {
  const q = new URLSearchParams(data);
  const a = q.get("a");
  const d = q.get("d");
  if (!a || !d) return null;
  return { a, d, p: q.get("p") ?? undefined };
}
