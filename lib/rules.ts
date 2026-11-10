import { headcountWarning } from "./draft.js";
import { holidayName, isRestDay } from "./holidays.js";
import type { DraftItem } from "./types.js";

export interface PersonInfo {
  id: string;
  name: string;
  active: boolean;
  constraints: Record<string, unknown>;
}
export interface ExistingAssignment {
  person_id: string;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  label: string;
  vehicle?: string | null;
}
export interface RuleContext {
  people: Map<string, PersonInfo>;
  leaves: Set<string>; // `${personId}|${YYYY-MM-DD}`
  existing: ExistingAssignment[];
  defaultWaterTeamId?: string;
}
export interface Issue {
  level: "info" | "warn" | "block";
  text: string;
}

const DELIVERY = /送貨|送料/;
const WATER = /水電|給排水|排水|給水|水管|配管/;
const LOW_VOLTAGE = /弱電|監視|網路|攝影|門禁|對講/;

const mmdd = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const toMin = (t: string | null | undefined): number | null => {
  const m = t ? /^(\d{1,2}):(\d{2})/.exec(t) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const hhmm = (t: string) => t.slice(0, 5);
const overlap = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && b1 < a2;

/** 會改動人員名單的自動規則：排除請假／停用的人，水電工作預設排阿鎮 */
export function applyAutoRules(items: DraftItem[], ctx: RuleContext): DraftItem[] {
  return items.map((it) => {
    const keepIds: string[] = [];
    const keepNames: string[] = [];
    const excluded: string[] = [];
    const before = it.person_ids ?? [];

    before.forEach((id, i) => {
      const p = ctx.people.get(id);
      const name = p?.name ?? it.person_names?.[i] ?? id;
      if (p && !p.active) return void excluded.push(`${name} 已取消合作，已排除`);
      if (it.date && ctx.leaves.has(`${id}|${it.date}`)) return void excluded.push(`${name} ${mmdd(it.date)} 請假，已排除`);
      keepIds.push(id);
      keepNames.push(name);
    });

    let auto_note: string | undefined;
    const team = ctx.defaultWaterTeamId ? ctx.people.get(ctx.defaultWaterTeamId) : undefined;
    if (before.length === 0 && !it.unknown_people?.length && WATER.test(it.work) && team?.active) {
      if (!(it.date && ctx.leaves.has(`${team.id}|${it.date}`))) {
        keepIds.push(team.id);
        keepNames.push(team.name);
        auto_note = `水電相關工作，預設排給${team.name}，請確認`;
      }
    }
    return { ...it, person_ids: keepIds, person_names: keepNames, excluded, auto_note };
  });
}

/** 不改動名單，只產生提醒（warn）與阻擋（block）；info 是自動規則的說明 */
export function evaluateItems(items: DraftItem[], ctx: RuleContext): Issue[][] {
  return items.map((it, idx) => {
    const issues: Issue[] = [];
    const ids = it.person_ids ?? [];
    const nameOf = (id: string) => ctx.people.get(id)?.name ?? id;

    for (const n of it.excluded ?? []) issues.push({ level: "info", text: n });
    if (it.auto_note) issues.push({ level: "info", text: it.auto_note });

    // 單人出勤：除送貨、送料外，施工／維修建議至少 2 人
    // 若已有「原先預估 N 人，但指派了 M 人」的提醒，就不再重複顯示一般性的「建議至少 2 人」
    if (ids.length === 1 && !DELIVERY.test(it.work)) {
      const p = ctx.people.get(ids[0]);
      const isTeam = Number(p?.constraints.team_size ?? 1) >= 2;
      const soloOk = p?.constraints.solo_low_voltage === true && LOW_VOLTAGE.test(it.work);
      const noSolo = p?.constraints.no_solo === true;
      if (!isTeam && !soloOk && (noSolo || !headcountWarning(it))) {
        issues.push({
          level: "warn",
          text:
            p?.constraints.no_solo === true
              ? `${p.name} 不可單獨出勤（僅送貨、送料可以），請至少派 2 人`
              : `只派了 ${p?.name ?? "1 人"}，施工／維修建議至少 2 人`,
        });
      }
    }

    // 國定假日排班：提醒確認（一般週末不提醒）
    if (it.date && holidayName(it.date)) {
      issues.push({ level: "warn", text: `${mmdd(it.date)} 是國定假日（${holidayName(it.date)}），請確認是否要排班` });
    }

    // 假日（週末與國定假日）：阿杰原則不排
    if (it.date && isRestDay(it.date)) {
      for (const id of ids) {
        if (ctx.people.get(id)?.constraints.avoid_weekend === true) {
          issues.push({ level: "warn", text: `${nameOf(id)} 假日原則不排` });
        }
      }
    }

    // 車輛：CR-V 以冠璋為主，其他人使用要走特例
    if (it.vehicle === "CR-V") {
      const boss = [...ctx.people.values()].find((p) => p.name === "陳冠璋");
      if (it.vehicle_special) {
        issues.push({ level: "warn", text: "CR-V 特例使用，需冠璋同意" });
      } else if (boss && !ids.includes(boss.id)) {
        issues.push({ level: "warn", text: "CR-V 以冠璋為主；其他人使用請改選「CR-V（特例）」" });
      }
    }

    // 小時制不可重疊（雙方都有明確起訖時間才檢查）
    const s = toMin(it.start_time);
    const e = toMin(it.end_time);
    if (it.date && s !== null && e !== null && s < e) {
      for (const id of ids) {
        for (const ex of ctx.existing) {
          const xs = toMin(ex.start_time);
          const xe = toMin(ex.end_time);
          if (ex.person_id === id && ex.work_date === it.date && xs !== null && xe !== null && overlap(s, e, xs, xe)) {
            issues.push({
              level: "block",
              text: `${nameOf(id)} ${mmdd(it.date)} ${it.start_time}–${it.end_time} 與已排的「${ex.label}」（${hhmm(ex.start_time!)}–${hhmm(ex.end_time!)}）時間重疊`,
            });
          }
        }
        items.slice(0, idx).forEach((o) => {
          const os = toMin(o.start_time);
          const oe = toMin(o.end_time);
          if (o.date === it.date && (o.person_ids ?? []).includes(id) && os !== null && oe !== null && overlap(s, e, os, oe)) {
            issues.push({ level: "block", text: `${nameOf(id)} 在本次另一項「${[o.site, o.work].filter(Boolean).join(" ")}」時間重疊` });
          }
        });
      }
    }
    // 同一輛車同一時段不可重疊（也要雙方都有明確起訖時間）
    if (it.vehicle && it.date && s !== null && e !== null && s < e) {
      const clash: string[] = [];
      for (const ex of ctx.existing) {
        const xs = toMin(ex.start_time);
        const xe = toMin(ex.end_time);
        if (ex.vehicle === it.vehicle && ex.work_date === it.date && xs !== null && xe !== null && overlap(s, e, xs, xe)) {
          clash.push(`已排的「${ex.label}」（${hhmm(ex.start_time!)}–${hhmm(ex.end_time!)}）`);
        }
      }
      items.slice(0, idx).forEach((o) => {
        const os = toMin(o.start_time);
        const oe = toMin(o.end_time);
        if (o.vehicle === it.vehicle && o.date === it.date && os !== null && oe !== null && overlap(s, e, os, oe)) {
          clash.push(`本次另一項「${[o.site, o.work].filter(Boolean).join(" ")}」`);
        }
      });
      for (const c of clash) issues.push({ level: "block", text: `${it.vehicle} ${mmdd(it.date)} ${it.start_time}–${it.end_time} 與${c}時間重疊` });
    }
    return issues;
  });
}

export const hasBlock = (all: Issue[][]): boolean => all.some((l) => l.some((i) => i.level === "block"));
export const blockTexts = (all: Issue[][]): string[] => all.flatMap((l) => l.filter((i) => i.level === "block").map((i) => i.text));
