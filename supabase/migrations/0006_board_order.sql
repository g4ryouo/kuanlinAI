-- 人力表的顯示順序與暱稱（可重複執行）
alter table people add column if not exists sort_order int not null default 100;

update people set nickname = '冠璋', sort_order = 1 where name = '陳冠璋';
update people set nickname = '飛哥', sort_order = 2 where name = '張欽煌';
update people set nickname = '阿倫', sort_order = 3 where name = '莊岳倫';
update people set nickname = '阿東', sort_order = 4 where name = '楊東翰';
update people set nickname = '阿杰', sort_order = 5 where name = '王永杰';
update people set nickname = '阿盛', sort_order = 6 where name = '李弘盛';
update people set nickname = '阿澤', sort_order = 7 where name = '阿澤';
update people set nickname = '阿鎮', sort_order = 8 where name = '阿鎮';
