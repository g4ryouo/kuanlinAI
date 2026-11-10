import { createSign } from "node:crypto";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/** 容錯解析環境變數：支援整段 JSON、外面多包一層引號、base64；並給看得懂的錯誤 */
export function parseServiceAccount(raw: string): ServiceAccount {
  let text = (raw ?? "").trim();
  if (!text) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON 是空的，請貼整個服務帳戶金鑰檔的內容");
  if (!text.startsWith("{") && !text.startsWith('"')) {
    try {
      text = Buffer.from(text, "base64").toString("utf8").trim();
    } catch {
      /* 保持原樣，下面會報錯 */
    }
  }
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      text = JSON.parse(text) as string;
    } catch {
      /* 保持原樣 */
    }
  }
  let sa: Record<string, unknown>;
  try {
    sa = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON 不是有效的 JSON，請貼整個金鑰檔的內容（從第一個 { 到最後一個 }）");
  }
  if (sa.web || sa.installed) {
    throw new Error("這是 OAuth 用戶端憑證，不是服務帳戶金鑰；請到 Google Cloud 的服務帳戶下載 JSON 金鑰");
  }
  if (typeof sa.client_email !== "string" || typeof sa.private_key !== "string" || !sa.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON 缺少 client_email 或 private_key，請確認是服務帳戶（type: service_account）的 JSON 金鑰");
  }
  return { client_email: sa.client_email, private_key: sa.private_key.replace(/\\n/g, "\n") };
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/** 用服務帳戶金鑰換取唯讀存取權杖（不需額外套件） */
export async function getAccessToken(serviceAccountJson: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const sa = parseServiceAccount(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const sig = createSign("RSA-SHA256").update(`${header}.${claim}`).sign(sa.private_key);
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${b64url(sig)}`,
    }),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function batchGetValues(
  spreadsheetId: string,
  ranges: string[],
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[][][]> {
  const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
  const res = await fetchImpl(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${qs}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { valueRanges?: { values?: string[][] }[] };
  return (data.valueRanges ?? []).map((v) => v.values ?? []);
}
