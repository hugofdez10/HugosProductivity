create table if not exists public.pulso_tasks (
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, task_id)
);

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pulso_tasks'
  ) then
    alter publication supabase_realtime add table public.pulso_tasks;
  end if;
end $$;

alter table public.pulso_tasks enable row level security;

drop policy if exists "Pulso select own tasks" on public.pulso_tasks;
drop policy if exists "Hugo select own tasks" on public.pulso_tasks;
create policy "Hugo select own tasks"
on public.pulso_tasks
for select
to authenticated
using ((select auth.uid()) = user_id);

create table if not exists public.pulso_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  timezone text not null default 'UTC',
  user_agent text,
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists pulso_push_subscriptions_user_id_idx
on public.pulso_push_subscriptions (user_id);

alter table public.pulso_push_subscriptions enable row level security;

drop policy if exists "Hugo select own push subscriptions" on public.pulso_push_subscriptions;
create policy "Hugo select own push subscriptions"
on public.pulso_push_subscriptions
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Hugo insert own push subscriptions" on public.pulso_push_subscriptions;
create policy "Hugo insert own push subscriptions"
on public.pulso_push_subscriptions
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Hugo update own push subscriptions" on public.pulso_push_subscriptions;
create policy "Hugo update own push subscriptions"
on public.pulso_push_subscriptions
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Hugo delete own push subscriptions" on public.pulso_push_subscriptions;
create policy "Hugo delete own push subscriptions"
on public.pulso_push_subscriptions
for delete
to authenticated
using ((select auth.uid()) = user_id);

create table if not exists public.pulso_notification_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id text not null,
  kind text not null,
  fire_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, task_id, kind, fire_at)
);

create index if not exists pulso_notification_log_created_at_idx
on public.pulso_notification_log (created_at);

alter table public.pulso_notification_log enable row level security;

drop policy if exists "Hugo select own notification log" on public.pulso_notification_log;
create policy "Hugo select own notification log"
on public.pulso_notification_log
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Pulso insert own tasks" on public.pulso_tasks;
drop policy if exists "Hugo insert own tasks" on public.pulso_tasks;
create policy "Hugo insert own tasks"
on public.pulso_tasks
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Pulso update own tasks" on public.pulso_tasks;
drop policy if exists "Hugo update own tasks" on public.pulso_tasks;
create policy "Hugo update own tasks"
on public.pulso_tasks
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Pulso delete own tasks" on public.pulso_tasks;
drop policy if exists "Hugo delete own tasks" on public.pulso_tasks;
create policy "Hugo delete own tasks"
on public.pulso_tasks
for delete
to authenticated
using ((select auth.uid()) = user_id);
