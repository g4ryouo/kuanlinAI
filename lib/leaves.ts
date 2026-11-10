/** 請假申請表解析：只取姓名、日期、是否審核通過；不讀、不存請假原因 */

export interface SheetLeave {
  name: string;
  start: string; // YYYY-MM-DD
  end: string;
}

const DAY = 86_400_000;
const MD = /(\d{1,2})\s*\/\s*(\d{1,2})/;

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** 沒有申請日期可依據時的退路：只接受「過去 60 天到未來 60 天」內的日期，更舊的視為舊紀錄 */
export const WINDOW_PAST_DAYS = 60;
export const WINDOW_FUTURE_DAYS = 60;

/**
 * 表格日期沒有年份（例如 "3/26"、"10/22 8:30"）。
 * 在前後一年中，挑落在上述視窗內、離今天最近的那一年；都不在視窗內就回傳 null（視為舊紀錄）。
 */
export function parseSheetDate(raw: string | undefined, today: string): string | null {
  const m = raw ? MD.exec(raw) : null;
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const t = Date.parse(`${today}T00:00:00Z`);
  const baseYear = Number(today.slice(0, 4));
  let best: string | null = null;
  let bestDiff = Infinity;
  for (const y of [baseYear - 1, baseYear, baseYear + 1]) {
    const cand = Date.parse(`${iso(y, month, day)}T00:00:00Z`);
    if (Number.isNaN(cand) || new Date(cand).getUTCDate() !== day) continue; // 例如 2/30
    const days = Math.round((cand - t) / DAY);
    if (days < -WINDOW_PAST_DAYS || days > WINDOW_FUTURE_DAYS) continue;
    if (Math.abs(days) < bestDiff) {
      bestDiff = Math.abs(days);
      best = iso(y, month, day);
    }
  }
  return best;
}

const WEEKDAY: Record<string, number> = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };
const APPLIED = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\(\s*(Su|Mo|Tu|We|Th|Fr|Sa)\s*\)/;

/** 申請日期像 "2/10(Tu)"：用星期反推年份，取「不晚於今天」的最近一年 */
export function parseAppliedDate(raw: string | undefined, today: string): string | null {
  const m = raw ? APPLIED.exec(raw) : null;
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const wd = WEEKDAY[m[3]];
  const baseYear = Number(today.slice(0, 4));
  for (let y = baseYear + 1; y >= baseYear - 6; y--) {
    const d = new Date(Date.UTC(y, month - 1, day));
    if (d.getUTCMonth() !== month - 1 || d.getUTCDay() !== wd) continue;
    if (d.getTime() > Date.parse(`${today}T00:00:00Z`) + DAY) continue; // 申請日不會在未來
    return iso(y, month, day);
  }
  return null;
}

const minusDays = (isoDate: string, n: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);

/** 以申請日期的年份為基準，補上請假日期的年份；請假日比申請日早很多（超過 60 天）代表跨到隔年 */
function startFromApplied(raw: string | undefined, applied: string): string | null {
  const m = raw ? MD.exec(raw) : null;
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const y = Number(applied.slice(0, 4));
  const cand = iso(y, month, day);
  if (Number.isNaN(Date.parse(cand)) || new Date(`${cand}T00:00:00Z`).getUTCDate() !== day) return null;
  return cand < minusDays(applied, 60) ? iso(y + 1, month, day) : cand;
}

/** 結束日以開始日為基準：早於開始很多（超過半年）是跨年；只早一點視為打錯，當作單日 */
function endFromStart(raw: string | undefined, start: string): string {
  const m = raw ? MD.exec(raw) : null;
  if (!m) return start;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const y = Number(start.slice(0, 4));
  const cand = iso(y, month, day);
  if (Number.isNaN(Date.parse(cand)) || new Date(`${cand}T00:00:00Z`).getUTCDate() !== day) return start;
  if (cand >= start) return cand;
  return cand < minusDays(start, 180) ? iso(y + 1, month, day) : start;
}

/**
 * rows：B~E 欄（姓名、類別、開始、結束）；statuses：H 欄；applied：J 欄（申請日期）。
 * 只留「審核通過」。有申請日期就用它推年份，沒有才用視窗規則。
 */
export function parseLeaves(rows: string[][], statuses: string[][], applied: string[][], today: string): SheetLeave[] {
  const out: SheetLeave[] = [];
  rows.forEach((r, i) => {
    if ((statuses[i]?.[0] ?? "").trim() !== "審核通過") return;
    const name = (r[0] ?? "").trim();
    if (!name) return;
    const anchor = parseAppliedDate(applied[i]?.[0], today);
    let start: string | null;
    let end: string | null;
    if (anchor) {
      start = startFromApplied(r[2], anchor);
      end = start ? endFromStart(r[3], start) : null;
    } else {
      start = parseSheetDate(r[2], today);
      end = parseSheetDate(r[3], today) ?? start;
      if (start && end && end < start) end = start;
    }
    if (!start || !end) return;
    out.push({ name, start, end });
  });
  return out;
}

/** 展開成每一天，單筆最多 31 天，避免打錯字造成整年請假 */
export function expandDates(l: SheetLeave): string[] {
  const days: string[] = [];
  const s = Date.parse(`${l.start}T00:00:00Z`);
  const e = Date.parse(`${l.end}T00:00:00Z`);
  for (let t = s, n = 0; t <= e && n < 31; t += DAY, n++) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}
