import * as board from "./liff/board.js";
import * as config from "./liff/config.js";
import * as followupMove from "./liff/followup-move.js";
import * as followupSave from "./liff/followup-save.js";
import * as followups from "./liff/followups.js";
import * as pool from "./liff/pool.js";
import * as poolAssign from "./liff/pool-assign.js";
import * as poolCancel from "./liff/pool-cancel.js";
import * as siteArchive from "./liff/site-archive.js";
import * as siteDelete from "./liff/site-delete.js";
import * as siteSave from "./liff/site-save.js";
import * as sites from "./liff/sites.js";
import * as today from "./liff/today.js";

/**
 * 所有 LIFF 的 API 合併成 Vercel 的「一個」函式（免費方案每個部署最多 12 個函式）。
 * 網址不變：/api/liff/<名稱> 由 vercel.json 的 rewrite 轉到 /api/liff?route=<名稱>。
 */
type Handler = (request: Request) => Promise<Response>;
interface Route {
  GET?: Handler;
  POST?: Handler;
}

export const ROUTES: Record<string, Route> = {
  config,
  today,
  board,
  pool,
  "pool-assign": poolAssign,
  "pool-cancel": poolCancel,
  sites,
  "site-save": siteSave,
  "site-archive": siteArchive,
  "site-delete": siteDelete,
  followups,
  "followup-save": followupSave,
  "followup-move": followupMove,
};

/** 路由名稱：優先用 rewrite 帶來的 ?route=，否則取網址最後一段 */
export function routeName(request: Request): string {
  const u = new URL(request.url);
  return u.searchParams.get("route") ?? u.pathname.split("/").filter(Boolean).pop() ?? "";
}

export async function dispatch(method: "GET" | "POST", request: Request): Promise<Response> {
  const name = routeName(request);
  const route = Object.hasOwn(ROUTES, name) ? ROUTES[name] : undefined;
  if (!route) return Response.json({ error: "找不到這個功能" }, { status: 404 });
  const handler = route[method];
  if (!handler) return Response.json({ error: "不支援這個方法" }, { status: 405 });
  return handler(request);
}
