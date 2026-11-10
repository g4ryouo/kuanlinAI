import type { DraftItem } from "./types.js";

/** 工作內容還沒填（AI 標為待確認，或是空白） */
export function needsWork(it: DraftItem): boolean {
  return it.uncertain.includes("work") || it.work.trim() === "" || it.work.trim() === "待確認";
}

/** 原先預估人數與實際指派人數不同時的提醒文字；一致或沒預估就回 null */
export function headcountWarning(it: DraftItem): string | null {
  const assigned = it.person_ids?.length ?? 0;
  if (!it.headcount || !assigned || it.headcount === assigned) return null;
  return `原先預估 ${it.headcount} 人，但指派了 ${assigned} 人，請確認是否正確`;
}

export const AWAIT_WORK_MINUTES = 15;
export const MAX_WORK_TEXT = 60;

export const VEHICLE_OPTIONS: { code: string; name: string | null; special: boolean; label: string }[] = [
  { code: "z", name: "ZINGER", special: false, label: "ZINGER" },
  { code: "w", name: "WISH", special: false, label: "WISH" },
  { code: "c", name: "CR-V", special: false, label: "CR-V" },
  { code: "s", name: "CR-V", special: true, label: "CR-V（特例）" },
  { code: "n", name: null, special: false, label: "不指定車輛" },
];

/** 把 AI 抓到的車輛字樣對應到正式車名；對不到就當沒指定 */
export function normalizeVehicle(v: string | null | undefined): string | null {
  if (!v) return null;
  if (/cr-?v/i.test(v)) return "CR-V";
  if (/zinger/i.test(v)) return "ZINGER";
  if (/wish/i.test(v)) return "WISH";
  return null;
}

/** 卡片「時間」欄：日期加上起訖時間 */
export function timeText(it: DraftItem): string {
  const date = it.date ?? "日期待確認";
  if (it.start_time && it.end_time) return `${date} ${it.start_time}–${it.end_time}`;
  if (it.start_time) return `${date} ${it.start_time} 起`;
  return [date, it.time_slot].filter(Boolean).join(" ");
}

export function workKind(work: string): "S" | "R" | "V" {
  if (/維修|修|壞|故障/.test(work)) return "R";
  if (/場勘|會議|報價|勘查/.test(work)) return "V";
  return "S";
}

/** 什麼都沒抓到的項目（沒案場、沒工作內容、沒日期、沒人）：不值得產生一張確認卡 */
export function isEmptyItem(it: DraftItem): boolean {
  return !it.site && needsWork(it) && !it.date && !(it.people?.length) && !(it.person_ids?.length);
}
