import { db } from "./db.js";
import { env } from "./env.js";
import { extractEdits, extractTasks } from "./ai.js";
import { dayInfo } from "./holidays.js";
import { isEmptyItem } from "./draft.js";
import { AWAIT_WORK_MINUTES, MAX_WORK_TEXT, VEHICLE_OPTIONS, needsWork, normalizeVehicle, workKind } from "./draft.js";
import { shortError } from "./errors.js";
import { menuReply } from "./menu.js";
import { loadBrief } from "./briefSend.js";
import { loadFollowupView } from "./followupData.js";
import { saveFollowup } from "./followupActions.js";
import { formatFollowups, formatToday } from "./summaries.js";
import { loadTodayView } from "./todayData.js";
import { syncLeaves } from "./syncLeaves.js";
import { resolveNames, type AliasMap } from "./aliases.js";
import { MAX_PICK, confirmCard, editListCard, followCard, expandId, leaveText, parsePostback, reassignQuickReply, vehicleQuickReply } from "./flex.js";
import { applyAutoRules, blockTexts, evaluateItems } from "./rules.js";
import { loadRuleContext } from "./ruleContext.js";
import type { FollowUpDraft, LeaveNote } from "./types.js";
import { transcribe, transcribePrompt } from "./transcribe.js";
import { getAudioContent, getImageContent, replyMessages, type LineEvent, type LineMessage } from "./line.js";
import type { DraftItem } from "./types.js";
import { applyEdits, describeItems } from "./jobEdit.js";
import { AWAIT_EDIT_MINUTES, draftItemFromTask, findEditingDraft, latestOpenDraft, listEditableJobs, saveEditedTask } from "./editFlow.js";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_MS = 3 * 60 * 1000; // 語音最長 3 分鐘

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

async function renderCard(draftId: string, items: DraftItem[], leaves: import("./types.js").LeaveNote[] = []): Promise<LineMessage> {
  const ctx = await loadRuleContext(items);
  return confirmCard(draftId, items, leaves, evaluateItems(items, ctx));
}

async function bossId(): Promise<string | null> {
  const { data } = await db().from("people").select("id").eq("name", "陳冠璋").maybeSingle();
  return data?.id ?? null;
}

/** 這張卡每一項的人員名單都包含冠璋，才算「冠璋使用」 */
function bossAssigned(items: DraftItem[], boss: string | null): boolean {
  return !!boss && items.length > 0 && items.every((it) => it.person_ids?.includes(boss));
}


/** 冠璋剛按了「確認新增」但缺工作內容時，他接著回覆的短文字就是工作內容 */
async function tryFillWork(ev: LineEvent, userId: string, content: string): Promise<boolean> {
  const since = new Date(Date.now() - AWAIT_WORK_MINUTES * 60_000).toISOString();
  const { data, error } = await db()
    .from("drafts")
    .select("id, items, leaves")
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
  await reply(ev, [text(`已填上工作內容：${content}`), await renderCard(data.id, items, (data.leaves ?? []) as LeaveNote[])]);
  return true;
}

const EDIT_HINT = `直接告訴我要改什麼就好（文字或語音都可以），例如：
・工作改成「冷氣維修」
・改到明天 9 點
・人員換成阿哲、小張
・案場改成晶心，再加一台 ZINGER
${AWAIT_EDIT_MINUTES} 分鐘內回覆有效；改完還可以繼續改。`;

/** 冠璋按了「修改內容」後的下一則訊息：交給 AI 整理成修改，套用到那張卡，再重新給他確認 */
async function tryEdit(ev: LineEvent, userId: string, content: string, aliasMap: AliasMap, siteNames: string[]): Promise<boolean> {
  const draft = await findEditingDraft(userId);
  if (!draft) return false;
  const { today, weekday } = taipeiToday();
  const { edits, question } = await extractEdits(
    { text: content, current: describeItems(draft.items), today, weekday, aliases: [...aliasMap.keys()], sites: siteNames },
    env("ANTHROPIC_API_KEY"),
    env("ANTHROPIC_MODEL") || undefined,
  );
  if (!edits.length) {
    if (!question) return false; // 不像是修改，當作一般訊息繼續處理
    await reply(ev, [text(question)]);
    return true;
  }
  const result = applyEdits(draft.items, edits, aliasMap);
  if (!result.items.length) {
    await db().from("drafts").update({ items: [], status: "cancelled", handled_at: new Date().toISOString(), awaiting_edit_at: null }).eq("id", draft.id);
    await reply(ev, [text("這張卡的工作都移除了，已取消。")]);
    return true;
  }
  const ctx0 = await loadRuleContext(result.items);
  const items = applyAutoRules(result.items, ctx0);
  const ctx = await loadRuleContext(items);
  await db().from("drafts").update({ items, awaiting_work_at: null, ...(result.changed ? { awaiting_edit_at: new Date().toISOString() } : {}) }).eq("id", draft.id);
  await reply(ev, [
    ...(result.notes.length ? [text(result.notes.join("\n"))] : []),
    confirmCard(draft.id, items, (draft.leaves ?? []) as LeaveNote[], evaluateItems(items, ctx)),
  ]);
  return true;
}

/** 「修改工作」：列出還沒做完的工作讓冠璋挑 */
async function replyEditList(ev: LineEvent): Promise<void> {
  const jobs = await listEditableJobs(taipeiToday().today);
  if (!jobs.length) {
    await reply(ev, [text("目前沒有可以修改的工作（今天起、還沒做完的）。")]);
    return;
  }
  await reply(ev, [editListCard(jobs), ...(jobs.length > 8 ? [text(`只列出最近的 8 項，共 ${jobs.length} 項。`)] : [])]);
}

export async function handleMessage(ev: LineEvent, rawMessageId: string | null): Promise<void> {
  const msg = ev.message;
  const userId = ev.source?.userId;
  if (!msg || !userId) return;
  if (msg.type !== "text" && msg.type !== "image" && msg.type !== "audio") {
    await reply(ev, [text("目前支援文字、圖片和語音。")]);
    return;
  }

  if (msg.type === "text") {
    const canned = menuReply(msg.text);
    if (canned) {
      await reply(ev, [text(canned)]);
      return;
    }
  }

  if (msg.type === "text" && /^(今日|早安|今天)簡報$/.test(msg.text?.trim() ?? "")) {
    try {
      const { brief } = await loadBrief(taipeiToday().today);
      await reply(ev, [brief.flex]);
    } catch (e) {
      await reply(ev, [text(`產生簡報失敗：${shortError(e)}`)]);
    }
    return;
  }

  if (msg.type === "text" && msg.text?.trim() === "同步請假") {
    try {
      const r = await syncLeaves();
      await reply(ev, [text(`同步完成：寫入 ${r.inserted} 天請假，移除 ${r.removed} 天。${r.unknown.length ? `\n表單上對不到的姓名：${r.unknown.join("、")}` : ""}`)]);
    } catch (e) {
      await reply(ev, [text(`同步失敗：${shortError(e)}`)]);
    }
    return;
  }

  if (msg.type === "text" && /^(修改|編輯|改)(工作|派工)?$/.test(msg.text?.trim() ?? "")) {
    try {
      await replyEditList(ev);
    } catch (e) {
      await reply(ev, [text(`讀取工作失敗：${shortError(e)}`)]);
    }
    return;
  }

  // 沒辦法按按鈕時，直接打「確認」也能確認最近那張卡
  if (msg.type === "text" && /^確認(新增|修改)?(工作)?$/.test(msg.text?.trim() ?? "")) {
    const open = await latestOpenDraft(userId);
    if (open) {
      await confirmDraft(ev, open.id);
      return;
    }
  }

  const aliasMap = await loadAliasMap();
  const { data: sites } = await db().from("sites").select("name");
  const siteNames = (sites ?? []).map((s: { name: string }) => s.name);

  // 文字直接用；語音先轉成文字，之後走同一條流程
  let inputText: string | undefined = msg.type === "text" ? msg.text : undefined;
  let heard: string | null = null;
  if (msg.type === "audio") {
    if (!env("OPENAI_API_KEY")) {
      await reply(ev, [text("語音辨識還沒設定完成，請先用文字或照片。")]);
      return;
    }
    if ((msg.duration ?? 0) > MAX_AUDIO_MS) {
      await reply(ev, [text("語音太長了（超過 3 分鐘），請分段傳，或改用文字。")]);
      return;
    }
    const { audio, bytes } = await getAudioContent(msg.id, env("LINE_CHANNEL_ACCESS_TOKEN"));
    if (bytes > MAX_AUDIO_BYTES) {
      await reply(ev, [text("語音檔太大，請分段傳，或改用文字。")]);
      return;
    }
    const spoken = await transcribe(
      audio,
      env("OPENAI_API_KEY"),
      transcribePrompt([...aliasMap.keys()], siteNames),
      env("OPENAI_TRANSCRIBE_MODEL") || undefined,
    );
    if (!spoken) {
      await reply(ev, [text("我沒有聽清楚，請再說一次，或改用文字。")]);
      return;
    }
    inputText = spoken;
    heard = spoken;
  }
  // 讓使用者核對辨識結果
  const withHeard = (messages: LineMessage[]): LineMessage[] =>
    heard ? [text(`我聽到：「${heard}」\n如果聽錯了，請直接打字更正後重傳。`), ...messages] : messages;

  if (inputText?.trim() && (await tryEdit(ev, userId, inputText, aliasMap, siteNames))) return;

  if (inputText && inputText.trim().length <= MAX_WORK_TEXT) {
    if (await tryFillWork(ev, userId, inputText.trim())) return;
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

  const { today, weekday } = taipeiToday();

  const extraction = await extractTasks(
    {
      text: inputText,
      image,
      today,
      weekday,
      aliases: [...aliasMap.keys()],
      sites: siteNames,
    },
    env("ANTHROPIC_API_KEY"),
    env("ANTHROPIC_MODEL") || undefined,
  );

  // ---- 問句：直接從資料庫回答，不建立任何草稿 ----
  if (extraction.intent === "ask_followups") {
    await reply(ev, withHeard([text(formatFollowups(await loadFollowupView(today)))]));
    return;
  }
  if (extraction.intent === "ask_today") {
    const asked = extraction.query_date && /^\d{4}-\d{2}-\d{2}$/.test(extraction.query_date) ? extraction.query_date : today;
    await reply(ev, withHeard([text(formatToday(await loadTodayView(asked), asked === today))]));
    return;
  }

  const leaves = extraction.leaves.map((l) => ({ ...l, person_name: aliasMap.get(l.person.trim())?.name }));

  // ---- 要追蹤的事：先給冠璋確認，按了才寫進「待我回覆」 ----
  const followMessages: LineMessage[] = [];
  const followUps = sanitizeFollowUps(extraction.intent === "follow_up" ? extraction.follow_ups : []);
  if (followUps.length) {
    const { data: fdraft, error: ferr } = await db()
      .from("drafts")
      .insert({ raw_message_id: rawMessageId, line_user_id: userId, items: [], follow_ups: followUps })
      .select("id")
      .single();
    if (ferr || !fdraft) throw ferr ?? new Error("follow-up draft insert failed");
    followMessages.push(followCard(fdraft.id, followUps));
  }

  // 什麼都沒抓到的項目不產生確認卡
  const realItems = extraction.items.filter((it) => !isEmptyItem({ ...it, person_ids: [] }));

  if (!realItems.length) {
    if (followMessages.length) {
      await reply(ev, withHeard(followMessages));
      return;
    }
    if (leaves.length) {
      await reply(ev, withHeard([text(leaveText(leaves))]));
      return;
    }
    await reply(ev, withHeard([text(extraction.question ?? "我沒有從這則訊息看到要排的工作或要追蹤的事。要新增工作的話，請附上案場和內容。")]));
    return;
  }

  const resolvedItems: DraftItem[] = realItems.map((it) => {
    const { resolved, unknown } = resolveNames(it.people, aliasMap);
    return { ...it, vehicle: normalizeVehicle(it.vehicle), person_ids: resolved.map((p) => p.id), person_names: resolved.map((p) => p.name), unknown_people: unknown };
  });
  // 訊息裡提到的請假，也當作這次排班的排除條件
  const msgLeaves = leaves.flatMap((l) => {
    const p = aliasMap.get(l.person.trim());
    return p && l.date ? [`${p.id}|${l.date}`] : [];
  });
  const ruleCtx = await loadRuleContext(resolvedItems, msgLeaves);
  const items = applyAutoRules(resolvedItems, ruleCtx);

  const { data: draft, error } = await db()
    .from("drafts")
    .insert({ raw_message_id: rawMessageId, line_user_id: userId, items, leaves })
    .select("id")
    .single();
  if (error || !draft) throw error ?? new Error("draft insert failed");

  const messages: LineMessage[] = [confirmCard(draft.id, items, leaves, evaluateItems(items, ruleCtx)), ...followMessages];
  if (extraction.question) messages.unshift(text(extraction.question));
  await reply(ev, withHeard(messages));
}

/** AI 回來的追蹤事項：只留合法的、最多 5 件 */
export function sanitizeFollowUps(list: FollowUpDraft[] | undefined): FollowUpDraft[] {
  const ok = ["to_reply", "waiting_other", "flexible_hold"];
  return (list ?? [])
    .filter((f) => f && typeof f.title === "string" && f.title.trim() && ok.includes(f.status))
    .slice(0, 5)
    .map((f) => ({
      title: f.title.trim().slice(0, 80),
      status: f.status,
      contact: f.contact ? String(f.contact).trim().slice(0, 40) || null : null,
      site: f.site ? String(f.site).trim() || null : null,
      due_date: f.due_date && /^\d{4}-\d{2}-\d{2}$/.test(f.due_date) ? f.due_date : null,
      urgent: f.urgent === true,
    }));
}

/** 按「確認新增／確認修改」，或直接在聊天室打「確認」 */
async function confirmDraft(ev: LineEvent, draftId: string): Promise<void> {
  const done = () => reply(ev, [text("這張卡已經處理過了。")]);
  const { data: cur } = await db().from("drafts").select("items, status").eq("id", draftId).maybeSingle();
  if (!cur || !["pending", "later"].includes(cur.status)) return void (await done());

  const missing = (cur.items as DraftItem[]).filter(needsWork).length;
  if (missing) {
    await db().from("drafts").update({ awaiting_work_at: new Date().toISOString() }).eq("id", draftId);
    await reply(ev, [
      text(
        `還沒填工作內容，不能確認。\n請直接回覆工作內容（例如：弱電施工、監視器維修）${missing > 1 ? "，會套用到所有未填的項目" : ""}。${AWAIT_WORK_MINUTES} 分鐘內回覆有效。`,
      ),
    ]);
    return;
  }

  const blocks = blockTexts(evaluateItems(cur.items as DraftItem[], await loadRuleContext(cur.items as DraftItem[])));
  if (blocks.length) {
    await reply(ev, [text(`有衝突，不能確認：\n${blocks.map((b) => `・${b}`).join("\n")}\n請先按「改派人員」調整。`)]);
    return;
  }

  const { data: draft } = await db()
    .from("drafts")
    .update({ status: "confirmed", handled_at: new Date().toISOString() })
    .eq("id", draftId)
    .in("status", ["pending", "later"])
    .select("items")
    .maybeSingle();
  if (!draft) return void (await done());

  const items = draft.items as DraftItem[];
  const { data: vlist } = await db().from("vehicles").select("id, name");
  const vehicleId = new Map((vlist ?? []).map((v: { id: string; name: string }) => [v.name, v.id]));
  let assigned = 0;
  let edited = 0;
  for (const it of items) {
    if (it.task_id) {
      // 修改已經排好的工作：更新原本那筆，不要重複新增
      assigned += (await saveEditedTask(it, vehicleId)).people;
      edited++;
      continue;
    }
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
        work: it.work,
        wanted_date: it.date,
        headcount: it.headcount,
        start_time: it.start_time ?? null,
        end_time: it.end_time ?? null,
      })
      .select("id")
      .single();
    if (error || !task) throw error ?? new Error("task insert failed");

    if (it.date && it.person_ids?.length) {
      const rows = it.person_ids.map((pid) => ({
        task_id: task.id, person_id: pid, work_date: it.date, kind: workKind(it.work), fixed: it.fixed,
        start_time: it.start_time ?? null, end_time: it.end_time ?? null,
        vehicle_id: (it.vehicle && vehicleId.get(it.vehicle)) || null,
        day_type: dayInfo(it.date!).day_type,
        pay_mode: dayInfo(it.date!).pay_mode,
      }));
      const { error: aerr } = await db().from("assignments").insert(rows);
      if (aerr) throw aerr;
      assigned += rows.length;
    }
  }
  const special = items.some((it) => it.vehicle_special);
  await db().from("audit_log").insert({
    actor: ev.source?.userId ?? "unknown", action: edited ? "draft.confirm_edit" : "draft.confirm", entity: "drafts", entity_id: draftId,
    detail: special ? { cr_v_special: true, edited } : edited ? { edited } : null,
  });
  const pool = items.filter((it) => !it.date || !it.person_ids?.length).length;
  const head = edited === items.length ? `已修改 ${edited} 項工作，目前排 ${assigned} 人次。` : `已新增 ${items.length - edited} 項工作${edited ? `、修改 ${edited} 項` : ""}，排入 ${assigned} 人次。`;
  await reply(ev, [text(`${head}${pool ? `\n${pool} 項缺日期或人員，先放在待排池。` : ""}${special ? "\nCR-V 特例使用，記得向冠璋確認。" : ""}`)]);
  return;
}

export async function handlePostback(ev: LineEvent): Promise<void> {
  const pb = ev.postback ? parsePostback(ev.postback.data) : null;
  if (!pb) return;
  const done = () => reply(ev, [text("這張卡已經處理過了。")]);

  if (pb.a === "confirm") {
    await confirmDraft(ev, pb.d);
    return;
  }

  if (pb.a === "edit") {
    const { data } = await db()
      .from("drafts")
      .update({ awaiting_edit_at: new Date().toISOString(), awaiting_work_at: null })
      .eq("id", pb.d)
      .in("status", ["pending", "later"])
      .select("id")
      .maybeSingle();
    if (!data) return void (await done());
    await reply(ev, [text(EDIT_HINT)]);
    return;
  }

  if (pb.a === "editjob") {
    const userId = ev.source?.userId;
    if (!userId) return;
    const item = await draftItemFromTask(pb.d);
    if (!item) {
      await reply(ev, [text("找不到這項工作，可能已經完成或取消了。")]);
      return;
    }
    const { data: draft, error } = await db()
      .from("drafts")
      .insert({ line_user_id: userId, items: [item], awaiting_edit_at: new Date().toISOString() })
      .select("id")
      .single();
    if (error || !draft) throw error ?? new Error("edit draft insert failed");
    const ctx = await loadRuleContext([item]);
    await reply(ev, [text(`好，要改這項工作的哪裡？\n${EDIT_HINT}`), confirmCard(draft.id, [item], [], evaluateItems([item], ctx))]);
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
    const { data: draft } = await db().from("drafts").select("items, status, leaves").eq("id", pb.d).maybeSingle();
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
    const picked = (draft.items as DraftItem[]).map((it) => ({
      ...it,
      person_ids: selected.map((p) => p.id),
      person_names: selected.map((p) => p.name),
      unknown_people: [],
      auto_note: undefined,
      uncertain: it.uncertain.filter((f) => f !== "people"),
    }));
    const ctx = await loadRuleContext(picked);
    const items = applyAutoRules(picked, ctx);
    await db().from("drafts").update({ items }).eq("id", pb.d);
    await reply(ev, [text(`已改派給 ${selected.map((p) => p.name).join("、")}。`), confirmCard(pb.d, items, (draft.leaves ?? []) as LeaveNote[], evaluateItems(items, ctx))]);
  }

  if (pb.a === "fconfirm") {
    const { data: draft } = await db()
      .from("drafts")
      .update({ status: "confirmed", handled_at: new Date().toISOString() })
      .eq("id", pb.d)
      .in("status", ["pending", "later"])
      .select("follow_ups")
      .maybeSingle();
    if (!draft) return void (await done());
    const list = sanitizeFollowUps(draft.follow_ups as FollowUpDraft[]);
    const { data: siteRows } = await db().from("sites").select("id, name");
    const siteId = new Map((siteRows ?? []).map((x: { id: string; name: string }) => [x.name, x.id]));
    const count = { to_reply: 0, waiting_other: 0, flexible_hold: 0 } as Record<string, number>;
    let failed = 0;
    for (const f of list) {
      const r = await saveFollowup(
        { title: f.title, status: f.status, contact: f.contact, site_id: f.site ? siteId.get(f.site) ?? null : null, due_date: f.due_date, urgent: f.urgent },
        ev.source?.userId ?? "unknown",
      );
      if (r.ok) count[f.status]++;
      else failed++;
    }
    const parts = [
      count.to_reply ? `待我回覆 ${count.to_reply} 件` : "",
      count.waiting_other ? `等對方回覆 ${count.waiting_other} 件` : "",
      count.flexible_hold ? `機動待辦 ${count.flexible_hold} 件` : "",
    ].filter(Boolean);
    await reply(ev, [text(`已加入追蹤：${parts.join("、") || "0 件"}。${failed ? `\n有 ${failed} 件資料不完整沒有加入。` : ""}\n可以在選單「待我回覆」查看。`)]);
    return;
  }

  if (pb.a === "fskip") {
    const { data } = await db()
      .from("drafts")
      .update({ status: "cancelled", handled_at: new Date().toISOString() })
      .eq("id", pb.d)
      .in("status", ["pending", "later"])
      .select("id")
      .maybeSingle();
    await reply(ev, [text(data ? "好，不加入追蹤。" : "這張卡已經處理過了。")]);
    return;
  }

  if (pb.a === "vehicle") {
    const { data: draft } = await db().from("drafts").select("status, items").eq("id", pb.d).maybeSingle();
    if (!draft || !["pending", "later"].includes(draft.status)) return void (await done());
    await reply(ev, [vehicleQuickReply(pb.d, bossAssigned(draft.items as DraftItem[], await bossId()))]);
    return;
  }

  if (pb.a === "veh") {
    const opt = VEHICLE_OPTIONS.find((o) => o.code === pb.v);
    const { data: draft } = await db().from("drafts").select("items, status, leaves").eq("id", pb.d).maybeSingle();
    if (!draft || !["pending", "later"].includes(draft.status)) return void (await done());
    if (!opt) return;
    // 舊的快速回覆按鈕可能還留在聊天室：人員已改過、冠璋不在名單時，不接受一般的 CR-V
    if (opt.code === "c" && !bossAssigned(draft.items as DraftItem[], await bossId())) {
      await reply(ev, [text("CR-V 以冠璋為主，其他人使用請改選「CR-V（特例）」。"), vehicleQuickReply(pb.d, false)]);
      return;
    }
    const items = (draft.items as DraftItem[]).map((it) => ({ ...it, vehicle: opt.name, vehicle_special: opt.special }));
    await db().from("drafts").update({ items }).eq("id", pb.d);
    const ctx = await loadRuleContext(items);
    await reply(ev, [
      text(opt.name ? `已選擇車輛：${opt.label}。` : "已改為不指定車輛。"),
      confirmCard(pb.d, items, (draft.leaves ?? []) as LeaveNote[], evaluateItems(items, ctx)),
    ]);
  }
}
