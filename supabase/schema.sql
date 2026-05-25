create table if not exists public.sweepstake_state (
  room_id text primary key,
  app_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.admin_room_access (
  room_id text primary key,
  pin_hash text not null,
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

drop trigger if exists admin_room_access_updated_at on public.admin_room_access;
create trigger admin_room_access_updated_at
before update on public.admin_room_access
for each row
execute function public.set_updated_at();

alter table public.sweepstake_state enable row level security;
alter table public.admin_room_access enable row level security;

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

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'sweepstake_state'
    ) then
      alter publication supabase_realtime add table public.sweepstake_state;
    end if;
  end if;
end;
$$;

create or replace function public.verify_admin_pin(room_input text, pin_input text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_room_access a
    where a.room_id = room_input
      and a.pin_hash = extensions.crypt(pin_input, a.pin_hash)
  );
$$;

grant execute on function public.verify_admin_pin(text, text) to anon, authenticated;
