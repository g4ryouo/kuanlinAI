import { allowedUserIds, env } from "./env.js";

export type AuthResult = { ok: true; userId: string; name?: string } | { ok: false; status: number; message: string };

/** 向 LINE 驗證網頁登入拿到的 ID token（需為同一個 Provider，sub 才會等於聊天室的 userId） */
export async function verifyIdToken(
  idToken: string,
  channelId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sub: string; name?: string }> {
  const res = await fetchImpl("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  if (!res.ok) throw new Error(`LINE verify ${res.status}`);
  const data = (await res.json()) as { sub?: string; name?: string };
  if (!data.sub) throw new Error("LINE verify: no sub");
  return { sub: data.sub, name: data.name };
}

/** 驗證 Authorization: Bearer <ID token>，並確認在白名單內 */
export async function authorize(request: Request, fetchImpl: typeof fetch = fetch): Promise<AuthResult> {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!m) return { ok: false, status: 401, message: "請從 LINE 開啟" };
  const channelId = env("LINE_LOGIN_CHANNEL_ID");
  if (!channelId) return { ok: false, status: 500, message: "尚未設定 LINE_LOGIN_CHANNEL_ID" };
  let who: { sub: string; name?: string };
  try {
    who = await verifyIdToken(m[1], channelId, fetchImpl);
  } catch {
    return { ok: false, status: 401, message: "登入已過期，請重新開啟" };
  }
  if (!allowedUserIds().has(who.sub)) return { ok: false, status: 403, message: "你沒有權限查看這個畫面" };
  return { ok: true, userId: who.sub, name: who.name };
}
