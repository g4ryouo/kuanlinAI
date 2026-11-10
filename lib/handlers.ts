import { db } from "./db.js";
import { env } from "./env.js";
import { extractTasks } from "./ai.js";
import { resolveNames, type AliasMap } from "./aliases.js";
import { confirmCard, parsePostback, reassignQuickReply } from "./flex.js";
import { getImageContent, replyMessages, type LineEvent, type LineMessage } from "./line.js";
import type { DraftItem } from "./types.js";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function reply(ev: LineEvent, messages: LineMessage[]) {
  if (!ev.replyToken) return Promise.resolve();
  return replyMessages(ev.replyToken, messages, env("LINE_CHANNEL_ACCESS_TOKEN"));
}
const text = (t: string): LineMessage => ({ type: "text", text: t });

function taipeiToday(): { today: string; weekday: string } {
  const now = new Date();
  const today = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][
    new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" })).getDay()
  ];
  return { today, weekday };
}

async function loadAliasMap(): Promise<AliasMap> {
  const { data, error } = await db().from("aliases").select("alias, people(id, name)");
  if (error) throw error;
  const map: AliasMap = new Map();
  for (const r of (data ?? []) as unknown as { alias: string; people: { id: string; name: string } }[]) {
    if (r.people) map.set(r.alias, r.people);
  }
  return map;
}

function workKind(work: string): "S" | "R" | "V" {
  if (/維修|修|壞|故障/.test(work)) return "R";
  if (/場勘|會議|報價|勘查/.test(work)) return "V";
  return "S";
}

export async function handleMessage(ev: LineEvent, rawMessageId: string | null): Promise<void> {
  const msg = ev.message;
  const userId = ev.source?.userId;
  if (!msg || !userId) return;
  if (msg.type !== "text" && msg.type !== "image") {
    await reply(ev, [text("目前先支援文字和圖片，語音之後再開放。")]);
    return;
  }

  let image: { mediaType: string; base64: string } | undefined;
  if (msg.type === "image") {
    const img = await getImageContent(msg.id, env("LINE_CHANNEL_ACCESS_TOKEN"));
    if (img.bytes > MAX_IMAGE_BYTES) {
      await reply(ev, [text("圖片太大，請傳小一點的圖，或改用文字說明。")]);
      return;
    }
    image = img;
  }

  const aliasMap = await loadAliasMap();
  const { data: sites } = await db().from("sites").select("name");
  const { today, weekday } = taipeiToday();

  const extraction = await extractTasks(
    {
      text: msg.text,
      image,
      today,
      weekday,
      aliases: [...aliasMap.keys()],
      sites: (sites ?? []).map((s: { name: string }) => s.name),
    },
    env("ANTHROPIC_API_KEY"),
    env("ANTHROPIC_MODEL") || undefined,
  );

  if (!extraction.items.length) {
    await reply(ev, [text(extraction.question ?? "我沒有從這則訊息看到要排的工作。要新增任務的話，請附上案場和內容。")]);
    return;
  }

  const items: DraftItem[] = extraction.items.map((it) => {
    const { resolved, unknown } = resolveNames(it.people, aliasMap);
    return { ...it, person_ids: resolved.map((p) => p.id), person_names: resolved.map((p) => p.name), unknown_people: unknown };
  });

  const { data: draft, error } = await db()
    .from("drafts")
    .insert({ raw_message_id: rawMessageId, line_user_id: userId, items })
    .select("id")
    .single();
  if (error || !draft) throw error ?? new Error("draft insert failed");

  const messages: LineMessage[] = [confirmCard(draft.id, items)];
  if (extraction.question) messages.unshift(text(extraction.question));
  await reply(ev, messages);
}

export async function handlePostback(ev: LineEvent): Promise<void> {
  const pb = ev.postback ? parsePostback(ev.postback.data) : null;
  if (!pb) return;
  const done = () => reply(ev, [text("這張卡已經處理過了。")]);

  if (pb.a === "confirm") {
    const { data: draft } = await db()
      .from("drafts")
      .update({ status: "confirmed", handled_at: new Date().toISOString() })
      .eq("id", pb.d)
      .in("status", ["pending", "later"])
      .select("items")
      .maybeSingle();
    if (!draft) return void (await done());

    const items = draft.items as DraftItem[];
    let assigned = 0;
    for (const it of items) {
      const { data: site } = it.site
        ? await db().from("sites").select("id").eq("name", it.site).maybeSingle()
        : { data: null };
      const { data: task, error } = await db()
        .from("tasks")
        .insert({
          title: [it.site, it.work].filter(Boolean).join(" "),
          site_id: site?.id ?? null,
          status: "to_handle",
          priority: it.priority,
        })
        .select("id")
        .single();
      if (error || !task) throw error ?? new Error("task insert failed");

      if (it.date && it.person_ids?.length) {
        const rows = it.person_ids.map((pid) => ({
          task_id: task.id, person_id: pid, work_date: it.date, kind: workKind(it.work), fixed: it.fixed,
        }));
        const { error: aerr } = await db().from("assignments").insert(rows);
        if (aerr) throw aerr;
        assigned += rows.length;
      }
    }
    await db().from("audit_log").insert({ actor: ev.source?.userId ?? "unknown", action: "draft.confirm", entity: "drafts", entity_id: pb.d });
    const pool = items.filter((it) => !it.date || !it.person_ids?.length).length;
    await reply(ev, [text(`已新增 ${items.length} 項工作，排入 ${assigned} 人次。${pool ? `\n${pool} 項缺日期或人員，先放在待排池。` : ""}`)]);
    return;
  }

  if (pb.a === "later") {
    const { data } = await db()
      .from("drafts")
      .update({ status: "later", handled_at: new Date().toISOString() })
      .eq("id", pb.d)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    await reply(ev, [text(data ? "好，先保留，這張卡之後還能按「確認新增」。" : "這張卡已經處理過了。")]);
    return;
  }

  if (pb.a === "reassign") {
    const { data: draft } = await db().from("drafts").select("status").eq("id", pb.d).maybeSingle();
    if (!draft || !["pending", "later"].includes(draft.status)) return void (await done());
    const { data: people } = await db().from("people").select("id, name").in("role", ["field", "outsourced"]).eq("active", true);
    await reply(ev, [reassignQuickReply(pb.d, people ?? [])]);
    return;
  }

  if (pb.a === "assign" && pb.p) {
    const { data: draft } = await db().from("drafts").select("items, status").eq("id", pb.d).maybeSingle();
    if (!draft || !["pending", "later"].includes(draft.status)) return void (await done());
    const { data: person } = await db().from("people").select("id, name").eq("id", pb.p).maybeSingle();
    if (!person) return;
    const items = (draft.items as DraftItem[]).map((it) => ({
      ...it, person_ids: [person.id], person_names: [person.name], unknown_people: [],
      uncertain: it.uncertain.filter((f) => f !== "people"),
    }));
    await db().from("drafts").update({ items }).eq("id", pb.d);
    await reply(ev, [text(`已改派給 ${person.name}。`), confirmCard(pb.d, items)]);
  }
}
