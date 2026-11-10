import { db } from "./db.js";
import type { ExistingAssignment, PersonInfo, RuleContext } from "./rules.js";
import type { DraftItem } from "./types.js";

export async function loadRuleContext(items: DraftItem[], extraLeaves: string[] = []): Promise<RuleContext> {
  const dates = [...new Set(items.map((i) => i.date).filter((d): d is string => !!d))];
  const { data: ppl, error } = await db().from("people").select("id, name, active, constraints");
  if (error) throw error;
  const people = new Map<string, PersonInfo>((ppl ?? []).map((p: PersonInfo) => [p.id, p]));
  const leaves = new Set<string>(extraLeaves);
  const existing: ExistingAssignment[] = [];
  if (dates.length) {
    const { data: lv } = await db().from("leaves").select("person_id, leave_date").eq("approved", true).in("leave_date", dates);
    for (const l of (lv ?? []) as { person_id: string; leave_date: string }[]) leaves.add(`${l.person_id}|${l.leave_date}`);
    const { data: asg } = await db()
      .from("assignments")
      .select("person_id, work_date, start_time, end_time, tasks(title), vehicles(name)")
      .in("work_date", dates);
    for (const a of (asg ?? []) as unknown as { person_id: string; work_date: string; start_time: string | null; end_time: string | null; tasks: { title: string } | null; vehicles: { name: string } | null }[]) {
      existing.push({ person_id: a.person_id, work_date: a.work_date, start_time: a.start_time, end_time: a.end_time, label: a.tasks?.title ?? "已排工作", vehicle: a.vehicles?.name ?? null });
    }
  }
  const team = [...people.values()].find((p) => p.name === "阿鎮");
  return { people, leaves, existing, defaultWaterTeamId: team?.id };
}
