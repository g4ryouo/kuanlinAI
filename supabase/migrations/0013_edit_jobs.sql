-- 冠璋按「修改內容」後，下一則訊息就是修改指示（15 分鐘內有效）（可重複執行）
alter table drafts add column if not exists awaiting_edit_at timestamptz;
