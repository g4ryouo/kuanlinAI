-- 案場「結案」：移到已結案分頁，歷史排班與任務都保留（可重複執行）
alter table sites add column if not exists archived_at timestamptz;
