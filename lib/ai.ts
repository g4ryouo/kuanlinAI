import type { Extraction } from "./types.js";

export interface ExtractInput {
  text?: string;
  image?: { mediaType: string; base64: string };
  today: string; // YYYY-MM-DD（台北時間）
  weekday: string; // 例如「二」
  aliases: string[];
  sites: string[];
}

const TOOL = {
  name: "submit_tasks",
  description: "回報從訊息整理出的派工任務草稿。每個案場或每件工作一筆。",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            site: { type: ["string", "null"], description: "案場或客戶名稱，訊息沒提就 null" },
            work: { type: "string", description: "工作內容，簡短" },
            date: { type: ["string", "null"], description: "YYYY-MM-DD，沒提就 null" },
            time_slot: { type: ["string", "null"], description: "例如 上午、下午、11:00，沒提就 null" },
            people: { type: "array", items: { type: "string" }, description: "訊息中出現的人員稱呼，照原文，不要自行對應或猜測" },
            vehicle: { type: ["string", "null"] },
            headcount: { type: ["integer", "null"] },
            priority: { type: "string", enum: ["low", "normal", "high"] },
            fixed: { type: "boolean", description: "是否固定時間" },
            uncertain: { type: "array", items: { type: "string" }, description: "不確定的欄位名稱，例如 site、date、people" },
          },
          required: ["site", "work", "date", "time_slot", "people", "vehicle", "headcount", "priority", "fixed", "uncertain"],
        },
      },
      leaves: {
        type: "array",
        description: "訊息中提到請假或休假的人。請假不是工作，不要放進 items。",
        items: {
          type: "object",
          properties: {
            person: { type: "string", description: "人員稱呼，照原文" },
            date: { type: ["string", "null"], description: "YYYY-MM-DD，沒提就 null" },
          },
          required: ["person", "date"],
        },
      },
      question: { type: ["string", "null"], description: "資訊不足以整理時，要問冠璋的一句繁體中文問題；否則 null" },
    },
    required: ["items", "leaves", "question"],
  },
} as const;

function systemPrompt(i: ExtractInput): string {
  return [
    "你是寬林公司的派工助理，把老闆轉傳或口述的訊息整理成任務草稿。使用繁體中文。",
    `今天是 ${i.today}（星期${i.weekday}），時區台北。「明天」「下週一」等相對日期請換算成 YYYY-MM-DD。`,
    `已知人員稱呼：${i.aliases.join("、")}。`,
    `已知案場：${i.sites.join("、")}。`,
    "規則：",
    "- 不確定就填 null 並把欄位名稱放進 uncertain，不要自行假設（例如「師傅」是誰）。",
    "- people 只放訊息裡出現的稱呼原文，不要推測沒提到的人。",
    "- LINE 轉傳不帶來源，訊息沒有案場或客戶名稱時，site 填 null，並在 question 問是哪個案場。",
    "- 訊息不是派工或任務（閒聊、問候）時，items 回空陣列，question 填 null。",
    "- 一則訊息可能含多件工作，各自一筆。",
    "- 沒有說明要做什麼工作時，work 填「待確認」並把 work 放進 uncertain，不要自行編造工作內容。",
    "- 提到某人請假或休假：放進 leaves（person、date），不要當成工作。",
    "- question 只能是要問老闆的問題，不要說「已記下」「已登記」「已處理」「已安排」等，你無法保證任何事已被記錄；請假只提示，系統不會寫入，不要在 question 提到請假。",
    "一律呼叫 submit_tasks 回報。",
  ].join("\n");
}

export async function extractTasks(
  input: ExtractInput,
  apiKey: string,
  model = "claude-sonnet-5-5",
  fetchImpl: typeof fetch = fetch,
): Promise<Extraction> {
  const content: unknown[] = [];
  if (input.image) {
    content.push({ type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.base64 } });
  }
  content.push({ type: "text", text: input.text?.trim() || "（圖片訊息，請依圖片內容整理）" });

  const messages: { role: string; content: unknown }[] = [{ role: "user", content }];

  // 這個模型不支援強制 tool_choice，改用 auto，並在沒呼叫工具時重試一次
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        system: systemPrompt(input),
        tools: [TOOL],
        tool_choice: { type: "auto" },
        messages,
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);

    const data = (await res.json()) as { content?: { type: string; name?: string; input?: Extraction }[] };
    const block = data.content?.find((b) => b.type === "tool_use" && b.name === TOOL.name);
    if (block?.input) {
      return { items: block.input.items ?? [], leaves: block.input.leaves ?? [], question: block.input.question ?? null };
    }

    messages.push({ role: "assistant", content: data.content ?? [] });
    messages.push({ role: "user", content: "請呼叫 submit_tasks 回報結果；不是派工訊息就回空的 items。" });
  }
  throw new Error("AI 沒有回報結構化結果");
}
