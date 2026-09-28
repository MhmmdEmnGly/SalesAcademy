-- Satış simülasyonu yapay zekâ modu: kullanıcı başına günlük kullanım sayacı.
-- Sadece Edge Function (service role) okur ve yazar; tarayıcıdan erişim yok. Tekrar çalıştırılabilir.
create table if not exists public.sim_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  sims int not null default 0,
  turns int not null default 0,
  primary key (user_id, day)
);
alter table public.sim_usage enable row level security;
revoke all on public.sim_usage from anon, authenticated;
