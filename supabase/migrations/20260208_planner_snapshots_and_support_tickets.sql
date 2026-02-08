-- Planner snapshots and support ticket storage
create table if not exists public.planner_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists planner_snapshots_updated_at_idx
  on public.planner_snapshots (updated_at desc);

alter table public.planner_snapshots enable row level security;

create policy "Planner snapshots are viewable by owner" on public.planner_snapshots
  for select
  using (auth.uid() = user_id);

create policy "Planner snapshots are insertable by owner" on public.planner_snapshots
  for insert
  with check (auth.uid() = user_id);

create policy "Planner snapshots are updatable by owner" on public.planner_snapshots
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Planner snapshots are deletable by owner" on public.planner_snapshots
  for delete
  using (auth.uid() = user_id);

revoke all on public.planner_snapshots from anon, authenticated;
grant select, insert, update, delete on public.planner_snapshots to authenticated;

drop trigger if exists set_planner_snapshots_updated_at on public.planner_snapshots;
create trigger set_planner_snapshots_updated_at
before update on public.planner_snapshots
for each row
execute procedure public.set_updated_at();

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  subject text not null,
  message text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'support_tickets_status_check'
  ) then
    alter table public.support_tickets
      add constraint support_tickets_status_check
      check (status in ('open', 'in_progress', 'closed'));
  end if;
end $$;

create index if not exists support_tickets_user_id_idx on public.support_tickets (user_id);
create index if not exists support_tickets_status_idx on public.support_tickets (status);
create index if not exists support_tickets_created_at_idx on public.support_tickets (created_at desc);

alter table public.support_tickets enable row level security;

create policy "Support tickets are viewable by owner" on public.support_tickets
  for select
  using (auth.uid() = user_id);

create policy "Support tickets are insertable by owner" on public.support_tickets
  for insert
  with check (auth.uid() = user_id);

revoke all on public.support_tickets from anon, authenticated;
grant select, insert on public.support_tickets to authenticated;

drop trigger if exists set_support_tickets_updated_at on public.support_tickets;
create trigger set_support_tickets_updated_at
before update on public.support_tickets
for each row
execute procedure public.set_updated_at();
