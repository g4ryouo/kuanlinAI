export interface DraftItem {
  site: string | null;
  work: string;
  date: string | null; // YYYY-MM-DD
  time_slot: string | null;
  people: string[]; // 訊息裡出現的稱呼（原文）
  vehicle: string | null;
  headcount: number | null;
  priority: "low" | "normal" | "high";
  fixed: boolean;
  start_time?: string | null; // HH:MM，只有訊息明確提到幾點才有
  end_time?: string | null;
  uncertain: string[]; // 不確定、需冠璋確認的欄位名稱
  // 以下由後端依別名字典填入
  person_ids?: string[];
  person_names?: string[];
  unknown_people?: string[];
  excluded?: string[]; // 被規則自動排除的人與原因
  auto_note?: string; // 系統預設的說明（例如水電預設排阿鎮）
}

export interface LeaveNote {
  person: string; // 訊息中的稱呼
  date: string | null;
  person_name?: string; // 對應到的正式姓名
}

export interface Extraction {
  items: DraftItem[];
  leaves: LeaveNote[]; // 偵測到的請假，只提示，不寫入
  question: string | null; // 資訊不足時要問冠璋的一句話
}
