-- 階段 2：確認時若缺工作內容，記錄「等待冠璋回覆工作內容」的時間（15 分鐘內有效）
alter table drafts add column if not exists awaiting_work_at timestamptz;
