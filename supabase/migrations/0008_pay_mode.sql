-- 假日（週末與國定假日）出勤算「點工」，影響薪資計算。
-- 寫入排班時就記下，薪資系統之後可直接查：
--   select * from assignments where pay_mode = 'daily';            -- 所有點工
--   select * from assignments where day_type = 'holiday';          -- 國定假日出勤
--   select * from assignments where day_type = 'weekend';          -- 週末出勤
-- 可重複執行。

alter table assignments add column if not exists day_type text not null default 'workday'
  check (day_type in ('workday','weekend','holiday'));
alter table assignments add column if not exists pay_mode text not null default 'regular'
  check (pay_mode in ('regular','daily'));
create index if not exists assignments_pay_mode_idx on assignments (pay_mode, work_date);

-- 補上既有資料：國定假日（依政府行政機關辦公日曆）與週末
update assignments set day_type = 'holiday', pay_mode = 'daily'
  where work_date in ('2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-27', '2026-04-03', '2026-04-06', '2026-05-01', '2026-06-19', '2026-09-25', '2026-09-28', '2026-10-09', '2026-10-26', '2026-12-25', '2027-01-01', '2027-02-04', '2027-02-05', '2027-02-08', '2027-02-09', '2027-02-10', '2027-03-01', '2027-04-05', '2027-04-06', '2027-04-30', '2027-06-09', '2027-09-15', '2027-09-28', '2027-10-11', '2027-10-25', '2027-12-24', '2027-12-31');
update assignments set day_type = 'weekend', pay_mode = 'daily'
  where day_type = 'workday' and extract(dow from work_date) in (0, 6);
