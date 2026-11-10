-- 確認卡草稿保存偵測到的請假提示，讓改派、選車輛後重發的卡也還看得到（可重複執行）
alter table drafts add column if not exists leaves jsonb not null default '[]';
