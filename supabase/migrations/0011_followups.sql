-- 追蹤事項（待我回覆／等對方回覆／機動待辦）：用 tasks 表，加幾個欄位並以 follow_up 標記與排班任務區分（可重複執行）
alter table tasks add column if not exists follow_up boolean not null default false;
alter table tasks add column if not exists contact text;          -- 對方是誰（客戶、廠商）
alter table tasks add column if not exists note text;
alter table tasks add column if not exists due_date date;         -- 回覆或處理期限
alter table tasks add column if not exists completed_at timestamptz;
create index if not exists tasks_follow_up_idx on tasks (follow_up, status);
