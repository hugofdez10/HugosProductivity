alter table public.pulso_notification_log enable row level security;

drop policy if exists "Hugo select own notification log" on public.pulso_notification_log;
create policy "Hugo select own notification log"
on public.pulso_notification_log
for select
to authenticated
using ((select auth.uid()) = user_id);
