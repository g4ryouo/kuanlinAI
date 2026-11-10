-- 階段 2：確認卡草稿、人員／別名／車輛／案場種子資料

create table drafts (
  id uuid primary key default gen_random_uuid(),
  raw_message_id uuid references raw_messages(id),
  line_user_id text not null,
  items jsonb not null,                      -- 已解析的任務草稿（含已對應的 person_ids）
  status text not null default 'pending'
    check (status in ('pending','confirmed','later','cancelled')),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
alter table drafts enable row level security;

-- 人員（姓名以規格書附錄為準；外包只有暱稱）
with p as (
  insert into people (name, role, skills, constraints) values
    ('陳冠璋', 'owner',      '{}', '{}'),
    ('張欽煌', 'field',      '{}', '{}'),
    ('莊岳倫', 'field',      '{}', '{}'),
    ('楊東翰', 'field',      '{}', '{}'),
    ('王永杰', 'field',      '{}', '{}'),
    ('李弘盛', 'field',      '{}', '{"no_solo": true}'),
    ('駱心愉', 'admin',      '{}', '{}'),
    ('陳冠旭', 'admin',      '{}', '{}'),
    ('陳正偉', 'field',      '{}', '{"rarely_on_site": true}'),
    ('阿澤',   'outsourced', '{}', '{"daily_hire": true}'),
    ('阿鎮',   'outsourced', '{}', '{"team_size": 4}'),
    ('阿國',   'outsourced', '{}', '{"team_size": 8, "needs_owner_approval": true}')
  returning id, name
)
insert into aliases (alias, person_id)
select v.alias, p.id
from p join (values
  ('冠璋','陳冠璋'), ('老闆','陳冠璋'), ('陳冠璋','陳冠璋'),
  ('飛哥','張欽煌'), ('阿飛','張欽煌'), ('張欽煌','張欽煌'),
  ('阿倫','莊岳倫'), ('莊岳倫','莊岳倫'),
  ('阿東','楊東翰'), ('東翰','楊東翰'), ('阿翰','楊東翰'), ('楊東翰','楊東翰'),
  ('阿杰','王永杰'), ('王永杰','王永杰'),
  ('阿盛','李弘盛'), ('紅色','李弘盛'), ('李弘盛','李弘盛'),
  ('心愉','駱心愉'), ('駱心愉','駱心愉'),
  ('冠旭','陳冠旭'), ('陳冠旭','陳冠旭'),
  ('正偉','陳正偉'), ('陳正偉','陳正偉'),
  ('阿澤','阿澤'), ('阿鎮','阿鎮'), ('阿國','阿國')
) as v(alias, pname) on p.name = v.pname;

insert into vehicles (name, rules) values
  ('ZINGER', null),
  ('CR-V',   '調度需冠璋同意'),
  ('WISH',   null);

insert into sites (name) values
  ('MOLEX'), ('杜邦'), ('晶心'), ('廣明'), ('艾特電'), ('楊梅護理之家'), ('宜得利');
