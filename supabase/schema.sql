-- Satış Akademisi: ilerleme tablosu ve erişim kuralları
-- Supabase panelinde: SQL Editor -> New query -> bu dosyanın tamamını yapıştır -> Run
-- Tekrar tekrar çalıştırılabilir (idempotent).

-- 1) Eski/eksik kurulum temizliği:
--    progress tablosu varsa ama yapısı uygun değilse (user_id uuid ve birincil anahtar değilse)
--    ve içinde HİÇ satır yoksa silinip doğru yapıyla yeniden oluşturulur.
--    İçinde veri varsa dokunulmaz, sadece uyarı verilir.
do $$
declare
  v_type text;
  v_pk   boolean;
  v_rows bigint;
begin
  if to_regclass('public.progress') is not null then
    select data_type into v_type
      from information_schema.columns
     where table_schema = 'public' and table_name = 'progress' and column_name = 'user_id';

    select exists (
      select 1
        from pg_index i
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       where i.indrelid = 'public.progress'::regclass and i.indisprimary and a.attname = 'user_id'
    ) into v_pk;

    execute 'select count(*) from public.progress' into v_rows;

    if (v_type is distinct from 'uuid' or not v_pk) then
      if v_rows = 0 then
        drop table public.progress;
        raise notice 'Eski progress tablosu bos oldugu icin silindi, yeniden olusturulacak.';
      else
        raise exception 'progress tablosunda % satir var ve yapisi farkli (user_id tipi: %, birincil anahtar: %). Veri kaybi olmamasi icin durduruldu.', v_rows, v_type, v_pk;
      end if;
    end if;
  end if;
end $$;

-- 2) Tablo: her kullanıcı için tek satır, tüm ilerleme data (jsonb) içinde
create table if not exists public.progress (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 3) Satır düzeyinde güvenlik: herkes yalnızca kendi satırını görür ve değiştirir
alter table public.progress enable row level security;

-- Daha önce eklenmiş, adını bilmediğimiz kuralları temizle (fazladan açık bir kural kalmasın)
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'progress' loop
    execute format('drop policy %I on public.progress', p.policyname);
  end loop;
end $$;

create policy "progress: kendi satirini oku" on public.progress
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "progress: kendi satirini ekle" on public.progress
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "progress: kendi satirini guncelle" on public.progress
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "progress: kendi satirini sil" on public.progress
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Giriş yapmamış ziyaretçinin (anon) hiçbir erişimi olmasın
revoke all on public.progress from anon;
grant select, insert, update, delete on public.progress to authenticated;

-- 4) Kontrol: çıktıda 3 sütun, 4 kural ve rls = true görmelisin
select 'sutun' as tur, column_name::text as ad, data_type::text as detay
  from information_schema.columns where table_schema = 'public' and table_name = 'progress'
union all
select 'kural', policyname::text, cmd::text
  from pg_policies where schemaname = 'public' and tablename = 'progress'
union all
select 'rls', 'progress', relrowsecurity::text
  from pg_class where oid = 'public.progress'::regclass;
