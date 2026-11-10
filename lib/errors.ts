/** 給白名單內的人看的簡短錯誤原因；遮掉任何像金鑰的字串，並限制長度 */
export function shortError(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "object" && e !== null ? JSON.stringify(e) : String(e);
  return raw
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}
