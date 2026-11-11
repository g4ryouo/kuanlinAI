import { normalizeVehicle } from "./draft.js";
import { resolveNames, type AliasMap } from "./aliases.js";
import type { DraftItem } from "./types.js";

/** 對確認卡上第 index 項（從 1 開始）的修改；沒寫的欄位代表不動 */
export interface EditOp {
  index: number;
  remove?: boolean;
  site?: string | null;
  work?: string;
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  /** 整份人員名單換成這些（照訊息原文的稱呼） */
  people?: string[];
  vehicle?: string | null;
  headcount?: number | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const pad = (t: string) => (t.length === 4 ? `0${t}` : t);
const without = (list: string[], ...fields: string[]) => list.filter((f) => !fields.includes(f));

const LABEL: Record<string, string> = { site: "案場", work: "工作", date: "日期", start_time: "開始時間", end_time: "結束時間", people: "人員", vehicle: "車輛", headcount: "人數" };

export interface EditResult {
  items: DraftItem[];
  /** 給冠璋看的白話說明：改了什麼、哪些沒改成 */
  notes: string[];
  changed: boolean;
}

/** 把修改套用到草稿項目。純函式：不碰資料庫；人名用別名字典對應，對不到的標「待確認」 */
export function applyEdits(items: DraftItem[], ops: EditOp[], aliases: AliasMap): EditResult {
  const out = items.map((it) => ({ ...it, uncertain: [...it.uncertain] }));
  const notes: string[] = [];
  const removed = new Set<number>();
  let changed = false;

  for (const op of ops) {
    const i = Number(op.index) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= out.length) {
      notes.push(`找不到第 ${op.index} 項，沒有修改。`);
      continue;
    }
    const it = out[i];
    const tag = `第 ${i + 1} 項`;

    if (op.remove) {
      if (it.task_id) notes.push(`${tag}已經排進班表，不能在這裡移除；要取消請傳「取消工作」。`);
      else {
        removed.add(i);
        notes.push(`${tag}已移除。`);
        changed = true;
      }
      continue;
    }

    const did: string[] = [];
    if (op.site !== undefined) {
      const v = typeof op.site === "string" ? op.site.trim() : "";
      it.site = v || null;
      it.uncertain = v ? without(it.uncertain, "site") : [...new Set([...it.uncertain, "site"])];
      did.push(LABEL.site);
    }
    if (typeof op.work === "string" && op.work.trim()) {
      it.work = op.work.trim().slice(0, 60);
      it.uncertain = without(it.uncertain, "work");
      did.push(LABEL.work);
    }
    if (op.date !== undefined) {
      if (op.date === null) {
        it.date = null;
        it.uncertain = [...new Set([...it.uncertain, "date"])];
        did.push(LABEL.date);
      } else if (DATE.test(op.date) && !Number.isNaN(Date.parse(op.date))) {
        it.date = op.date;
        it.time_slot = null;
        it.uncertain = without(it.uncertain, "date", "time_slot");
        did.push(LABEL.date);
      } else notes.push(`${tag}的日期「${op.date}」看不懂，沒有修改。`);
    }
    for (const f of ["start_time", "end_time"] as const) {
      const v = op[f];
      if (v === undefined) continue;
      if (v === null) {
        it[f] = null;
        did.push(LABEL[f]);
      } else if (TIME.test(v)) {
        it[f] = pad(v);
        it.time_slot = null;
        did.push(LABEL[f]);
      } else notes.push(`${tag}的時間「${v}」看不懂，沒有修改。`);
    }
    if (it.start_time && it.end_time && it.start_time >= it.end_time) {
      notes.push(`${tag}的開始時間（${it.start_time}）不早於結束時間（${it.end_time}），請再確認。`);
    }
    if (op.people !== undefined) {
      const { resolved, unknown } = resolveNames(op.people, aliases);
      it.people = op.people;
      it.person_ids = resolved.map((p) => p.id);
      it.person_names = resolved.map((p) => p.name);
      it.unknown_people = unknown;
      it.excluded = [];
      it.auto_note = undefined;
      it.uncertain = without(it.uncertain, "people");
      did.push(LABEL.people);
    }
    if (op.vehicle !== undefined) {
      it.vehicle = normalizeVehicle(op.vehicle);
      it.vehicle_special = false;
      did.push(LABEL.vehicle);
    }
    if (op.headcount !== undefined) {
      it.headcount = op.headcount !== null && Number.isInteger(op.headcount) && op.headcount > 0 && op.headcount <= 30 ? op.headcount : null;
      did.push(LABEL.headcount);
    }
    if (did.length) {
      notes.push(`${tag}已修改：${did.join("、")}。`);
      changed = true;
    }
  }
  return { items: out.filter((_, i) => !removed.has(i)), notes, changed };
}

/** 修改訊息送進 AI 的現況摘要（第幾項、案場、工作、日期時間、人員、車輛） */
export function describeItems(items: DraftItem[]): string {
  return items
    .map((it, i) => {
      const time = it.start_time ? `${it.start_time}${it.end_time ? `–${it.end_time}` : " 起"}` : it.time_slot ?? "";
      const people = [...(it.person_names ?? []), ...(it.unknown_people ?? [])].join("、") || "未指定";
      return `第 ${i + 1} 項：案場=${it.site ?? "未定"}｜工作=${it.work}｜日期=${it.date ?? "未定"} ${time}｜人員=${people}｜車輛=${it.vehicle ?? "未指定"}｜人數=${it.headcount ?? "未定"}`;
    })
    .join("\n");
}
