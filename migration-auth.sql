
-- فعّل السياسات مع Supabase Auth
alter table items enable row level security;
alter table centers enable row level security;
alter table receipts enable row level security;
alter table issues enable row level security;
alter table returns enable row level security;

create table if not exists adjustments (
  id bigserial primary key,
  kind text not null check (kind in ('receipt','issue','return_empty','return_expired')),
  item_id bigint not null references items(id) on delete restrict,
  center_id bigint references centers(id) on delete set null,
  qty integer not null,
  happened_at date not null default (now()::date),
  note text,
  created_at timestamptz not null default now()
);
alter table adjustments enable row level security;

-- سياسات أساسية (قراءة وكتابة للمستخدمين authenticated)
create policy if not exists "items_auth_select" on items for select to authenticated using (true);
create policy if not exists "items_auth_ins"    on items for insert to authenticated with check (true);
create policy if not exists "items_auth_upd"    on items for update to authenticated using (true) with check (true);

create policy if not exists "centers_auth_select" on centers for select to authenticated using (true);
create policy if not exists "centers_auth_upd"    on centers for update to authenticated using (true) with check (true);

create policy if not exists "receipts_auth_rw" on receipts for all to authenticated using (true) with check (true);
create policy if not exists "issues_auth_rw"   on issues   for all to authenticated using (true) with check (true);
create policy if not exists "returns_auth_rw"  on returns  for all to authenticated using (true) with check (true);
create policy if not exists "adjustments_auth_rw" on adjustments for all to authenticated using (true) with check (true);

-- عمود رصيد ابتدائي للمراكز
alter table centers add column if not exists initial integer not null default 0;
