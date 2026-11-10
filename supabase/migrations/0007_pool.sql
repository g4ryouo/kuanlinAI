-- 待排池：任務要記住「想排的日期、人力需求、時間、工作內容」，並允許「取消」狀態（可重複執行）
alter table tasks add column if not exists wanted_date date;
alter table tasks add column if not exists headcount int;
alter table tasks add column if not exists start_time time;
alter table tasks add column if not exists end_time time;
alter table tasks add column if not exists work text;

alter table tasks drop constraint if exists tasks_status_check;
alter table tasks add constraint tasks_status_check
  check (status in ('to_reply','to_handle','waiting_other','flexible_hold','done','cancelled'));
