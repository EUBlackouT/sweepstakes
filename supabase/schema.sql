create table if not exists public.sweepstake_state (
  room_id text primary key,
  app_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sweepstake_state_updated_at on public.sweepstake_state;
create trigger sweepstake_state_updated_at
before update on public.sweepstake_state
for each row
execute function public.set_updated_at();

alter table public.sweepstake_state enable row level security;

drop policy if exists "anon read sweepstake" on public.sweepstake_state;
create policy "anon read sweepstake"
on public.sweepstake_state
for select
to anon
using (true);

drop policy if exists "anon write sweepstake" on public.sweepstake_state;
create policy "anon write sweepstake"
on public.sweepstake_state
for insert
to anon
with check (true);

drop policy if exists "anon update sweepstake" on public.sweepstake_state;
create policy "anon update sweepstake"
on public.sweepstake_state
for update
to anon
using (true)
with check (true);

alter publication supabase_realtime add table public.sweepstake_state;
