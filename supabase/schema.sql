create table if not exists public.pulso_tasks (
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, task_id)
);

alter table public.pulso_tasks enable row level security;

drop policy if exists "Pulso select own tasks" on public.pulso_tasks;
drop policy if exists "Hugo select own tasks" on public.pulso_tasks;
create policy "Hugo select own tasks"
on public.pulso_tasks
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
