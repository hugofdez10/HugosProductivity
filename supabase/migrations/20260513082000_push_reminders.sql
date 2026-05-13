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
