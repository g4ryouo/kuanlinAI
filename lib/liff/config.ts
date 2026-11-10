import { env } from "../env.js";

/** 前端需要的公開設定（LIFF ID 不是機密） */
export async function GET(): Promise<Response> {
  return Response.json({ liffId: env("LIFF_ID") }, { headers: { "cache-control": "no-store" } });
}
