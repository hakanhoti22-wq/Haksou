-- ═══════════════════════════════════════════════════════════════
--  Haksou Pro — base de données Supabase
--  À coller dans Supabase → SQL Editor → New query → Run.
--  Le script peut être relancé sans risque (il ne supprime rien).
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Entreprises et membres ─────────────────────────────────────
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  join_code   text not null unique default upper(substr(md5(random()::text), 1, 6)),
  address     text default '',
  phone       text default '',
  email       text default '',
  iban        text default '',
  currency    text not null default 'CHF',
  vat         numeric not null default 8.1,
  hourly_rate numeric not null default 95,
  week_hours  numeric not null default 42,
  modules     jsonb not null default '["pointage","conges","planning","interventions","factures","clients","stock","frais"]',
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  company_id  uuid references public.companies on delete set null,
  name        text not null,
  email       text default '',
  role        text not null default 'employe' check (role in ('admin', 'employe')),
  created_at  timestamptz not null default now()
);

-- Fonctions utilisées par les règles de sécurité
create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as
$$ select company_id from profiles where id = auth.uid() $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'admin' from profiles where id = auth.uid()), false) $$;

-- ── Tables des modules ─────────────────────────────────────────
create table if not exists public.punches (            -- 1. Pointage
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company() references public.companies on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  type text not null check (type in ('in', 'out')),
  at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.leaves (             -- 2. Congés
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company() references public.companies on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  kind text not null default 'Vacances',
  start_date date not null,
  end_date date not null,
  reason text default '',
  status text not null default 'en_attente' check (status in ('en_attente', 'approuve', 'refuse')),
  decided_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.shifts (             -- 3. Planning
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company() references public.companies on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  date date not null,
  start_time text not null,   -- « 08:00 »
  end_time text not null,
  note text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.clients (            -- Clients (partagés)
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company() references public.companies on delete cascade,
  name text not null,
  contact text default '', email text default '', phone text default '',
  address text default '', notes text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.interventions (      -- 4. Interventions
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company() references public.companies on delete cascade,
  client_id uuid references public.clients on delete set null,
  user_id uuid references public.profiles on delete set null,
  title text not null,
  date date,
  status text not null default 'planifiee' check (status in ('planifiee', 'en_cours', 'terminee')),
  hours numeric default 0,
  description text default '', work_done text default '', materials text default '',
  photos jsonb not null default '[]',     -- photos compressées (data-URL JPEG)
  signature text,                          -- signature du client (data-URL PNG)
  signer_name text default '',
  signed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.documents (          -- 5. Devis & factures
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company() references public.companies on delete cascade,
  kind text not null check (kind in ('devis', 'facture')),
  number text not null,
  client_id uuid references public.clients on delete set null,
  date date,
  due_date date,
  status text not null default 'brouillon',
  vat numeric not null default 0,
  lines jsonb not null default '[]',      -- [{desc, qty, price}]
  notes text default '',
  source_id uuid references public.documents on delete set null,
  paid_at date,
  created_at timestamptz not null default now(),
  unique (company_id, number)
);

create table if not exists public.items (              -- 6. Stock
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company() references public.companies on delete cascade,
  name text not null,
  ref text default '', barcode text default '',
  qty numeric not null default 0,
  min_qty numeric not null default 0,
  unit text default 'pce',
  price numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company() references public.companies on delete cascade,
  item_id uuid not null references public.items on delete cascade,
  user_id uuid default auth.uid() references public.profiles on delete set null,
  delta numeric not null,
  reason text default '',
  at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (           -- 7. Notes de frais
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company() references public.companies on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  date date not null default current_date,
  amount numeric not null check (amount >= 0),
  category text not null default 'Autre',
  description text default '',
  receipt text,                            -- photo du ticket (data-URL JPEG)
  status text not null default 'en_attente' check (status in ('en_attente', 'validee', 'refusee', 'remboursee')),
  created_at timestamptz not null default now()
);

-- Index pour garder l'appli rapide
create index if not exists punches_company_at on public.punches (company_id, at);
create index if not exists punches_user_at on public.punches (user_id, at);
create index if not exists shifts_company_date on public.shifts (company_id, date);
create index if not exists leaves_company on public.leaves (company_id, start_date);
create index if not exists interventions_company_date on public.interventions (company_id, date);
create index if not exists documents_company on public.documents (company_id, kind);
create index if not exists movements_item on public.movements (item_id, at);
create index if not exists expenses_company_date on public.expenses (company_id, date);

-- ═══════════════════════════════════════════════════════════════
--  SÉCURITÉ (Row Level Security)
--  • une entreprise ne voit JAMAIS les données d'une autre ;
--  • un employé ne voit que ses pointages, ses frais et ses demandes
--    de congé (+ les congés approuvés de ses collègues pour le planning) ;
--  • seul un responsable valide les congés/frais et modifie le planning.
-- ═══════════════════════════════════════════════════════════════
alter table public.companies     enable row level security;
alter table public.profiles      enable row level security;
alter table public.punches       enable row level security;
alter table public.leaves        enable row level security;
alter table public.shifts        enable row level security;
alter table public.clients       enable row level security;
alter table public.interventions enable row level security;
alter table public.documents     enable row level security;
alter table public.items         enable row level security;
alter table public.movements     enable row level security;
alter table public.expenses      enable row level security;

do $$
declare t text;
begin
  -- supprime les anciennes règles pour pouvoir relancer le script
  for t in select tablename from pg_tables where schemaname = 'public' and tablename in
    ('companies','profiles','punches','leaves','shifts','clients','interventions','documents','items','movements','expenses')
  loop
    execute (select coalesce(string_agg(format('drop policy if exists %I on public.%I;', policyname, t), ' '), '')
             from pg_policies where schemaname = 'public' and tablename = t);
  end loop;

  -- tables partagées par toute l'entreprise
  foreach t in array array['clients','interventions','documents','items','movements'] loop
    execute format('create policy "lecture entreprise" on public.%I for select using (company_id = public.my_company())', t);
    execute format('create policy "ajout entreprise" on public.%I for insert with check (company_id = public.my_company())', t);
    execute format('create policy "modif entreprise" on public.%I for update using (company_id = public.my_company()) with check (company_id = public.my_company())', t);
    execute format('create policy "suppr entreprise" on public.%I for delete using (company_id = public.my_company())', t);
  end loop;

  -- tables personnelles : chacun les siennes, le responsable voit tout
  foreach t in array array['punches','leaves','expenses'] loop
    execute format('create policy "ajout perso" on public.%I for insert with check (company_id = public.my_company() and (user_id = auth.uid() or public.is_admin()))', t);
    execute format('create policy "modif perso" on public.%I for update using (company_id = public.my_company() and (user_id = auth.uid() or public.is_admin())) with check (company_id = public.my_company())', t);
    execute format('create policy "suppr perso" on public.%I for delete using (company_id = public.my_company() and (user_id = auth.uid() or public.is_admin()))', t);
  end loop;
end $$;

create policy "lecture perso" on public.punches  for select using (company_id = public.my_company() and (user_id = auth.uid() or public.is_admin()));
create policy "lecture perso" on public.expenses for select using (company_id = public.my_company() and (user_id = auth.uid() or public.is_admin()));
create policy "lecture perso" on public.leaves   for select using (company_id = public.my_company() and (user_id = auth.uid() or public.is_admin() or status = 'approuve'));

-- planning : tout le monde le voit, seul le responsable le modifie
create policy "lecture planning" on public.shifts for select using (company_id = public.my_company());
create policy "gestion planning" on public.shifts for all using (company_id = public.my_company() and public.is_admin()) with check (company_id = public.my_company() and public.is_admin());

-- entreprise : visible par ses membres, modifiable par le responsable
create policy "lecture entreprise" on public.companies for select using (id = public.my_company());
create policy "modif entreprise" on public.companies for update using (id = public.my_company() and public.is_admin()) with check (id = public.my_company());

-- profils : on voit ses collègues ; le responsable change les rôles
create policy "lecture profils" on public.profiles for select using (id = auth.uid() or company_id = public.my_company());
create policy "modif profils" on public.profiles for update using (company_id = public.my_company() and public.is_admin()) with check (company_id = public.my_company());

-- Un employé ne peut pas valider lui-même ses congés ou ses frais
create or replace function public.guard_status() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' and new.status <> 'en_attente' then
    raise exception 'Seul un responsable peut valider cette demande.';
  end if;
  if tg_op = 'UPDATE' and (old.status <> 'en_attente' or new.status is distinct from old.status) then
    raise exception 'Cette demande a déjà été traitée par un responsable.';
  end if;
  return new;
end $$;

drop trigger if exists guard_status on public.leaves;
create trigger guard_status before insert or update on public.leaves for each row execute function public.guard_status();
drop trigger if exists guard_status on public.expenses;
create trigger guard_status before insert or update on public.expenses for each row execute function public.guard_status();

-- Un employé ne peut pas supprimer une demande déjà traitée
create or replace function public.guard_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  if not public.is_admin() and old.status <> 'en_attente' then
    raise exception 'Cette demande a déjà été traitée : demande à ton responsable.';
  end if;
  return old;
end $$;
drop trigger if exists guard_delete on public.leaves;
create trigger guard_delete before delete on public.leaves for each row execute function public.guard_delete();
drop trigger if exists guard_delete on public.expenses;
create trigger guard_delete before delete on public.expenses for each row execute function public.guard_delete();

-- ═══════════════════════════════════════════════════════════════
--  Fonctions appelées par l'appli
-- ═══════════════════════════════════════════════════════════════
create or replace function public.create_company(p_name text, p_user_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if exists (select 1 from profiles where id = auth.uid() and company_id is not null) then
    raise exception 'Tu fais déjà partie d''une entreprise.';
  end if;
  insert into companies (name) values (trim(p_name)) returning id into cid;
  insert into profiles (id, company_id, name, email, role)
  values (auth.uid(), cid, trim(p_user_name), (select email from auth.users where id = auth.uid()), 'admin')
  on conflict (id) do update set company_id = cid, name = excluded.name, role = 'admin';
  return cid;
end $$;

create or replace function public.join_company(p_code text, p_user_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if exists (select 1 from profiles where id = auth.uid() and company_id is not null) then
    raise exception 'Tu fais déjà partie d''une entreprise.';
  end if;
  select id into cid from companies where join_code = upper(trim(p_code));
  if cid is null then raise exception 'Code d''entreprise inconnu. Vérifie-le auprès de ton responsable.'; end if;
  insert into profiles (id, company_id, name, email, role)
  values (auth.uid(), cid, trim(p_user_name), (select email from auth.users where id = auth.uid()), 'employe')
  on conflict (id) do update set company_id = cid, name = excluded.name, role = 'employe';
  return cid;
end $$;

create or replace function public.update_my_name(p_name text) returns void
language sql security definer set search_path = public as
$$ update profiles set name = trim(p_name) where id = auth.uid() $$;

create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux responsables.'; end if;
  if p_user = auth.uid() then raise exception 'Tu ne peux pas te retirer toi-même.'; end if;
  update profiles set company_id = null, role = 'employe' where id = p_user and company_id = public.my_company();
end $$;

-- Un responsable ne peut pas transférer un membre vers une autre entreprise
-- ni retirer le dernier responsable
create or replace function public.guard_profile() returns trigger
language plpgsql set search_path = public as $$
begin
  -- depuis l'appli (rôle « authenticated »), l'entreprise d'un profil ne change que via les fonctions ci-dessus
  if current_user = 'authenticated' and (new.company_id is distinct from old.company_id or new.id <> old.id) then
    raise exception 'Changement d''entreprise interdit.';
  end if;
  if old.role = 'admin' and new.role <> 'admin' and new.company_id is not distinct from old.company_id
     and (select count(*) from profiles where company_id = old.company_id and role = 'admin') <= 1 then
    raise exception 'Il faut au moins un responsable dans l''entreprise.';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles for each row execute function public.guard_profile();

grant execute on function public.create_company(text, text), public.join_company(text, text),
  public.update_my_name(text), public.remove_member(uuid) to authenticated;
