-- Simule l'environnement Supabase (rôle authenticated, auth.uid(), auth.users) dans un PostgreSQL ordinaire.
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, encrypted_password text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
alter default privileges in schema public grant all on tables to authenticated;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','boss@a.ch'),('22222222-2222-2222-2222-222222222222','emp@a.ch'),('33333333-3333-3333-3333-333333333333','other@b.ch');
