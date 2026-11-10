/** 下方圖文選單用「文字」動作送出的指令，機器人直接回覆，不交給 AI 判讀 */

const HELP = [
  "【怎麼用】",
  "1. 轉傳客戶訊息、貼上文字、傳照片，或直接口述派工，例如：「明天飛哥跟阿倫去晶心裝監視器，11 點到 14 點」。我會整理成確認卡。",
  "2. 確認卡有四個按鈕：確認新增、改派人員（可連續加人）、選擇車輛、稍後處理。",
  "3. 工作內容沒寫清楚時，按「確認新增」我會請你補，直接回一句就好。",
  "4. 剛批准請假、想馬上生效，請傳「同步請假」。",
  "目前還不能處理語音，請改用文字或照片。",
].join("\n");

const ADD =
  "請直接轉傳訊息、貼上文字、傳照片，或口述派工給我。我會整理成任務，讓你確認。\n例如：「明天飛哥跟阿倫去晶心裝監視器」";

const NOT_READY = "這個畫面還在建置中，目前先用聊天室傳訊息派工就好。";

const COMMANDS: Record<string, string> = {
  新增任務: ADD,
  怎麼用: HELP,
  今日工作: NOT_READY,
  待我回覆: NOT_READY,
  人力排班: NOT_READY,
  專案總覽: NOT_READY,
};

/** 完全相符（去掉前後空白）才算指令，避免把正常派工訊息誤判 */
export function menuReply(text: string | undefined): string | null {
  const key = (text ?? "").trim();
  return Object.hasOwn(COMMANDS, key) ? COMMANDS[key] : null;
}
