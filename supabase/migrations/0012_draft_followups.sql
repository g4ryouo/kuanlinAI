-- 聊天室判斷出的「要追蹤的事」先放在草稿裡，等冠璋按「加入追蹤」才寫進任務（可重複執行）
alter table drafts add column if not exists follow_ups jsonb not null default '[]';
