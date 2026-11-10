export interface PersonRef {
  id: string;
  name: string;
}

export type AliasMap = Map<string, PersonRef>;

export function resolveNames(names: string[], map: AliasMap): { resolved: PersonRef[]; unknown: string[] } {
  const resolved = new Map<string, PersonRef>();
  const unknown: string[] = [];
  for (const raw of names) {
    const key = raw.trim();
    if (!key) continue;
    const hit = map.get(key);
    if (hit) resolved.set(hit.id, hit);
    else unknown.push(key);
  }
  return { resolved: [...resolved.values()], unknown };
}
