-- 寬林 AI 排班特助：階段 1 資料表（對應規格書第 7 節）
-- 所有表啟用 RLS 且不建立任何 policy：只有後端用 secret key 能存取，前端與匿名金鑰一律讀不到。

create extension if not exists pgcrypto;

create table people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  nickname text,
  line_user_id text unique,
  role text not null check (role in ('field','admin','outsourced','owner')),
  skills text[] not null default '{}',
  constraints jsonb not null default '{}',  -- 例如 {"no_solo": true}
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table aliases (
  alias text primary key,
  person_id uuid not null references people(id) on delete cascade
);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  rules text
);

create table sites (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  region text,
  stage text check (stage in ('survey','quote','construction','improve','acceptance','billing')),
  start_date date,
  end_date date,
  lead_person_id uuid references people(id),
  headcount_need text,
  deadline date,
  flexible boolean not null default true,
  risks text,
  open_issues text,
  updated_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  site_id uuid references sites(id),
  status text not null default 'to_reply'
    check (status in ('to_reply','to_handle','waiting_other','flexible_hold','done')),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  due_at timestamptz,
  source_message_id uuid,
  waiting_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete set null,
  person_id uuid not null references people(id),
  vehicle_id uuid references vehicles(id),
  work_date date not null,
  start_time time,
  end_time time,
  kind text not null check (kind in ('S','R','V','P','C','N')),
  fixed boolean not null default false,
  created_at timestamptz not null default now()
);
create index on assignments (work_date, person_id);

create table leaves (
  person_id uuid not null references people(id),
  leave_date date not null,
  approved boolean not null default false,  -- 只存日期與是否核准，不存原因
  primary key (person_id, leave_date)
);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  scheduled_for timestamptz not null,
  target_line_user_id text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  dedupe_key text unique,                   -- 避免重複推播
  sent_at timestamptz
);

create table raw_messages (
  id uuid primary key default gen_random_uuid(),
  event_id text unique,                     -- LINE webhookEventId，用來去重
  line_message_id text,
  line_user_id text,
  event_type text not null,
  message_type text,
  text text,
  payload jsonb not null,
  allowed boolean not null default false,
  received_at timestamptz not null default now()
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  entity text,
  entity_id text,
  detail jsonb,
  at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['people','aliases','vehicles','sites','tasks','assignments','leaves','reminders','raw_messages','audit_log']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
