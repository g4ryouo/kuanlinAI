import { describe, expect, it } from "vitest";
import { menuReply } from "../lib/menu.js";
import { transcribe, transcribePrompt } from "../lib/transcribe.js";

describe("transcribePrompt", () => {
  it("includes names and sites and stays short", () => {
    const p = transcribePrompt(["飛哥", "阿倫"], ["晶心", "杜邦"]);
    expect(p).toContain("飛哥、阿倫");
    expect(p).toContain("晶心、杜邦");
    expect(transcribePrompt(Array(500).fill("阿飛"), []).length).toBeLessThanOrEqual(500);
  });
});

describe("transcribe", () => {
  it("posts the audio with Mandarin, the prompt and the model, and returns trimmed text", async () => {
    let seen: { url: string; auth: string; form: FormData } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, auth: (init.headers as Record<string, string>).Authorization, form: init.body as FormData };
      return new Response(JSON.stringify({ text: "  明天飛哥去晶心  " }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await transcribe(Buffer.from([1, 2, 3]), "k", "提示", "m", fake);
    expect(out).toBe("明天飛哥去晶心");
    expect(seen!.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(seen!.auth).toBe("Bearer k");
    expect(seen!.form.get("model")).toBe("m");
    expect(seen!.form.get("language")).toBe("zh");
    expect(seen!.form.get("prompt")).toBe("提示");
    expect((seen!.form.get("file") as File).name).toBe("voice.m4a");
  });
  it("returns an empty string when nothing was heard", async () => {
    const fake = (async () => new Response(JSON.stringify({}), { status: 200 })) as typeof fetch;
    expect(await transcribe(Buffer.from([1]), "k", "", "m", fake)).toBe("");
  });
  it("throws a readable error on API failure", async () => {
    const fake = (async () => new Response("bad key", { status: 401 })) as typeof fetch;
    await expect(transcribe(Buffer.from([1]), "k", "", "m", fake)).rejects.toThrow("語音辨識 API 401");
  });
});

describe("help text mentions voice honestly", () => {
  it("tells users how voice works and that Taiwanese is not supported", () => {
    const help = menuReply("怎麼用")!;
    expect(help).toContain("我聽到");
    expect(help).toContain("台語");
    expect(help).not.toContain("還不能處理語音");
  });
});
