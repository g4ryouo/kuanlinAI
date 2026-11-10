import { db } from "./db.js";
import { env } from "./env.js";
import { extractTasks } from "./ai.js";
import { AWAIT_WORK_MINUTES, MAX_WORK_TEXT, needsWork } from "./draft.js";
import { resolveNames, type AliasMap } from "./aliases.js";
import { MAX_PICK, confirmCard, expandId, leaveText, parsePostback, reassignQuickReply } from "./flex.js";
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

/** 冠璋剛按了「確認新增」但缺工作內容時，他接著回覆的短文字就是工作內容 */
async function tryFillWork(ev: LineEvent, userId: string, content: string): Promise<boolean> {
  const since = new Date(Date.now() - AWAIT_WORK_MINUTES * 60_000).toISOString();
  const { data, error } = await db()
    .from("drafts")
    .select("id, items")
    .eq("line_user_id", userId)
    .in("status", ["pending", "later"])
    .gte("awaiting_work_at", since)
    .order("awaiting_work_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("awaiting_work lookup failed", error);
    return false;
  }
  if (!data) return false;

  const items = (data.items as DraftItem[]).map((it) =>
    needsWork(it) ? { ...it, work: content, uncertain: it.uncertain.filter((f) => f !== "work") } : it,
  );
  await db().from("drafts").update({ items, awaiting_work_at: null }).eq("id", data.id);
  await reply(ev, [text("已填上工作內容。"), confirmCard(data.id, items)]);
  return true;
}

export async function handleMessage(ev: LineEvent, rawMessageId: string | null): Promise<void> {
  const msg = ev.message;
  const userId = ev.source?.userId;
  if (!msg || !userId) return;
  if (msg.type !== "text" && msg.type !== "image") {
    await reply(ev, [text("目前先支援文字和圖片，語音之後再開放。")]);
    return;
  }

  if (msg.type === "text" && msg.text && msg.text.trim().length <= MAX_WORK_TEXT) {
    if (await tryFillWork(ev, userId, msg.text.trim())) return;
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

  const leaves = extraction.leaves.map((l) => ({ ...l, person_name: aliasMap.get(l.person.trim())?.name }));

  if (!extraction.items.length) {
    if (leaves.length) {
      await reply(ev, [text(leaveText(leaves))]);
      return;
    }
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

  const messages: LineMessage[] = [confirmCard(draft.id, items, leaves)];
  if (extraction.question) messages.unshift(text(extraction.question));
  await reply(ev, messages);
}

export async function handlePostback(ev: LineEvent): Promise<void> {
  const pb = ev.postback ? parsePostback(ev.postback.data) : null;
  if (!pb) return;
  const done = () => reply(ev, [text("這張卡已經處理過了。")]);

  if (pb.a === "confirm") {
    const { data: cur } = await db().from("drafts").select("items, status").eq("id", pb.d).maybeSingle();
    if (!cur || !["pending", "later"].includes(cur.status)) return void (await done());

    const missing = (cur.items as DraftItem[]).filter(needsWork).length;
    if (missing) {
      await db().from("drafts").update({ awaiting_work_at: new Date().toISOString() }).eq("id", pb.d);
      await reply(ev, [
        text(
          `還沒填工作內容，不能確認新增。\n請直接回覆工作內容（例如：弱電施工、監視器維修）${missing > 1 ? "，會套用到所有未填的項目" : ""}。${AWAIT_WORK_MINUTES} 分鐘內回覆有效。`,
        ),
      ]);
      return;
    }

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

  if (pb.a === "reassign" || pb.a === "pick" || pb.a === "done") {
    const { data: draft } = await db().from("drafts").select("items, status").eq("id", pb.d).maybeSingle();
    if (!draft || !["pending", "later"].includes(draft.status)) return void (await done());

    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const ids = [...new Set([...(pb.s ? pb.s.split(",").map(expandId) : []), ...(pb.a === "pick" && pb.p ? [expandId(pb.p)] : [])])]
      .filter((x) => UUID.test(x))
      .slice(0, MAX_PICK);

    const { data: everyone } = await db().from("people").select("id, name").in("role", ["field", "outsourced"]).eq("active", true);
    const people = everyone ?? [];
    const selected = ids.map((id) => people.find((p) => p.id === id)).filter((p): p is { id: string; name: string } => !!p);

    if (pb.a !== "done") {
      await reply(ev, [reassignQuickReply(pb.d, people, selected)]);
      return;
    }

    if (!selected.length) {
      await reply(ev, [text("還沒有選人。請先按「改派人員」選人。")]);
      return;
    }
    const items = (draft.items as DraftItem[]).map((it) => ({
      ...it,
      person_ids: selected.map((p) => p.id),
      person_names: selected.map((p) => p.name),
      unknown_people: [],
      uncertain: it.uncertain.filter((f) => f !== "people"),
    }));
    await db().from("drafts").update({ items }).eq("id", pb.d);
    await reply(ev, [text(`已改派給 ${selected.map((p) => p.name).join("、")}。`), confirmCard(pb.d, items)]);
  }
}
