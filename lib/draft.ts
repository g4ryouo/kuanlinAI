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
