-- 阿國已停止合作：移除別名與人員。
-- 若他已被排過班、請過假或擔任過案場主責，為了保留歷史紀錄，人員資料會留著並維持停用。
-- 可重複執行。
delete from aliases where person_id in (select id from people where name = '阿國');

delete from people p
where p.name = '阿國'
  and not exists (select 1 from assignments a where a.person_id = p.id)
  and not exists (select 1 from leaves l where l.person_id = p.id)
  and not exists (select 1 from sites s where s.lead_person_id = p.id);

update people set active = false where name = '阿國';
