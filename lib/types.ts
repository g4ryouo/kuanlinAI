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
  uncertain: string[]; // 不確定、需冠璋確認的欄位名稱
  // 以下由後端依別名字典填入
  person_ids?: string[];
  person_names?: string[];
  unknown_people?: string[];
}

export interface Extraction {
  items: DraftItem[];
  question: string | null; // 資訊不足時要問冠璋的一句話
}
