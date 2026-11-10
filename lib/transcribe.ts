/** 語音轉文字（目前用 OpenAI；想換服務只要改這個檔案） */

const DEFAULT_MODEL = "gpt-4o-transcribe";

/** 把人員稱呼與案場名稱當作辨識提示，幫助聽對暱稱與工地用語 */
export function transcribePrompt(aliases: string[], sites: string[]): string {
  const p = `寬林公司的派工語音，台灣華語。人員稱呼：${aliases.join("、")}。案場：${sites.join("、")}。`;
  return p.slice(0, 500);
}

export async function transcribe(
  audio: Buffer,
  apiKey: string,
  prompt: string,
  model: string = DEFAULT_MODEL,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/m4a" }), "voice.m4a");
  form.append("model", model);
  form.append("language", "zh");
  form.append("prompt", prompt);
  form.append("response_format", "json");

  const res = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`語音辨識 API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
