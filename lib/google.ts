import { createSign } from "node:crypto";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/** 用服務帳戶金鑰換取唯讀存取權杖（不需額外套件） */
export async function getAccessToken(serviceAccountJson: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const sa = JSON.parse(serviceAccountJson) as ServiceAccount;
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
