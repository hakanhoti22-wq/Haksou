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
  punch_self_edit boolean not null default true,  -- les employés peuvent corriger leurs pointages
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
  manual boolean not null default false,   -- ajouté après coup (pointage oublié)
  edited boolean not null default false,   -- heure ou type corrigé
  deleted boolean not null default false,  -- supprimé (jamais effacé pour de vrai)
  note text default '',                    -- motif de la dernière correction
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
  kind text not null check (kind in ('devis', 'facture', 'avoir')),  -- avoir = note de crédit
  number text,                             -- vide tant que la facture est un brouillon
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

-- ═══════════════════════════════════════════════════════════════
--  v2 — Factures conformes et journal des modifications
--  (ces lignes mettent aussi à jour une base créée avec la v1)
-- ═══════════════════════════════════════════════════════════════
alter table public.companies add column if not exists punch_self_edit boolean not null default true;
alter table public.punches add column if not exists manual boolean not null default false;
alter table public.punches add column if not exists edited boolean not null default false;
alter table public.punches add column if not exists deleted boolean not null default false;
alter table public.punches add column if not exists note text default '';
alter table public.documents alter column number drop not null;
alter table public.documents drop constraint if exists documents_kind_check;
alter table public.documents add constraint documents_kind_check check (kind in ('devis', 'facture', 'avoir'));

-- Journal : écrit uniquement par la base, jamais modifiable ni effaçable depuis l'appli
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  actor_id uuid references public.profiles on delete set null,   -- qui a fait l'action
  table_name text not null,
  row_id uuid not null,
  action text not null,
  details jsonb not null default '{}',
  at timestamptz not null default now()
);
create index if not exists audit_company_at on public.audit_log (company_id, at desc);
create index if not exists audit_row on public.audit_log (row_id);
alter table public.audit_log enable row level security;
drop policy if exists "lecture journal" on public.audit_log;
create policy "lecture journal" on public.audit_log for select
  using (company_id = public.my_company() and (public.is_admin() or actor_id = auth.uid() or details->>'user_id' = auth.uid()::text));

create or replace function public.log_action(p_company uuid, p_table text, p_row uuid, p_action text, p_details jsonb)
returns void language sql security definer set search_path = public as
$$ insert into audit_log (company_id, actor_id, table_name, row_id, action, details) values (p_company, auth.uid(), p_table, p_row, p_action, p_details) $$;
revoke execute on function public.log_action(uuid, text, uuid, text, jsonb) from public, anon, authenticated;

-- ── Pointages : rien n'est effacé, toute correction est tracée ──
drop policy if exists "suppr perso" on public.punches;   -- suppression = deleted = true

create or replace function public.punch_guard() returns trigger
language plpgsql set search_path = public as $$
declare can_edit boolean := public.is_admin()
  or coalesce((select punch_self_edit from companies where id = coalesce(new.company_id, old.company_id)), true);
begin
  if tg_op = 'INSERT' then
    new.deleted := false; new.edited := false;
    new.manual := abs(extract(epoch from (new.at - now()))) > 300;   -- plus de 5 min d'écart = ajouté après coup
    if new.manual and not can_edit then raise exception 'Ton responsable a désactivé les corrections de pointage.'; end if;
    if new.manual and coalesce(trim(new.note), '') = '' then raise exception 'Indique le motif de ce pointage oublié.'; end if;
    return new;
  end if;
  if not can_edit then raise exception 'Ton responsable a désactivé les corrections de pointage.'; end if;
  if old.deleted and not public.is_admin() then raise exception 'Ce pointage a été supprimé.'; end if;
  if (new.at, new.type, new.deleted) is distinct from (old.at, old.type, old.deleted) and coalesce(trim(new.note), '') = '' then
    raise exception 'Indique le motif de la correction.';
  end if;
  new.user_id := old.user_id; new.company_id := old.company_id; new.manual := old.manual;
  new.edited := old.edited or (new.at, new.type) is distinct from (old.at, old.type);
  return new;
end $$;
drop trigger if exists punch_guard on public.punches;
create trigger punch_guard before insert or update on public.punches for each row execute function public.punch_guard();

create or replace function public.punch_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.manual then
      perform log_action(new.company_id, 'punches', new.id, 'ajout', jsonb_build_object('user_id', new.user_id, 'type', new.type, 'at', new.at, 'note', new.note));
    end if;
  elsif (new.at, new.type, new.deleted) is distinct from (old.at, old.type, old.deleted) then
    perform log_action(new.company_id, 'punches', new.id, case when new.deleted and not old.deleted then 'suppression' else 'modification' end,
      jsonb_build_object('user_id', new.user_id, 'type_avant', old.type, 'type', new.type, 'at_avant', old.at, 'at', new.at, 'note', new.note));
  end if;
  return null;
end $$;
drop trigger if exists punch_audit on public.punches;
create trigger punch_audit after insert or update on public.punches for each row execute function public.punch_audit();

-- ── Factures : numérotées à l'émission, puis verrouillées ──
create or replace function public.doc_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.kind in ('facture', 'avoir') and old.number is not null then
      raise exception 'Une facture émise ne peut pas être supprimée (obligation de conservation). Crée une note de crédit.';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.kind in ('facture', 'avoir') and current_user = 'authenticated' then new.number := null; new.status := 'brouillon'; end if;
    return new;
  end if;
  if new.kind is distinct from old.kind then raise exception 'Le type de document ne peut pas changer.'; end if;
  if new.kind in ('facture', 'avoir') then
    if old.number is null and new.number is not null and current_user = 'authenticated' then
      raise exception 'Utilise « Émettre » pour numéroter une facture.';
    end if;
    if old.number is not null and (new.number, new.client_id, new.date, new.due_date, new.lines, new.vat, new.notes, new.source_id)
       is distinct from (old.number, old.client_id, old.date, old.due_date, old.lines, old.vat, old.notes, old.source_id) then
      raise exception 'Facture émise : elle ne peut plus être modifiée. Pour la corriger, crée une note de crédit.';
    end if;
    if old.number is null and new.number is null and new.status <> 'brouillon' then raise exception 'Émets d''abord la facture.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists doc_guard on public.documents;
create trigger doc_guard before insert or update or delete on public.documents for each row execute function public.doc_guard();

create or replace function public.doc_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform log_action(old.company_id, 'documents', old.id, 'suppression', jsonb_build_object('kind', old.kind, 'number', old.number));
  elsif tg_op = 'INSERT' then
    perform log_action(new.company_id, 'documents', new.id, 'creation', jsonb_build_object('kind', new.kind, 'number', new.number));
  elsif new.status is distinct from old.status and not (old.number is null and new.number is not null) then
    perform log_action(new.company_id, 'documents', new.id, 'statut', jsonb_build_object('avant', old.status, 'apres', new.status));
  end if;
  return null;
end $$;
drop trigger if exists doc_audit on public.documents;
create trigger doc_audit after insert or update or delete on public.documents for each row execute function public.doc_audit();

create or replace function public.issue_document(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare d documents; prefix text; n int; num text; credited numeric; total numeric;
begin
  select * into d from documents where id = p_id and company_id = my_company() for update;
  if not found then raise exception 'Document introuvable.'; end if;
  if d.kind not in ('facture', 'avoir') then raise exception 'Seules les factures et notes de crédit s''émettent.'; end if;
  if d.number is not null then raise exception 'Ce document est déjà émis (%).', d.number; end if;
  if d.client_id is null then raise exception 'Choisis un client avant d''émettre.'; end if;
  if jsonb_array_length(d.lines) = 0 then raise exception 'Ajoute au moins une ligne.'; end if;
  perform pg_advisory_xact_lock(hashtext(d.company_id::text || d.kind));   -- deux émissions en même temps : pas de doublon
  prefix := case d.kind when 'facture' then 'F-' else 'NC-' end || extract(year from coalesce(d.date, current_date))::int || '-';
  select coalesce(max(substring(number from length(prefix) + 1)::int), 0) + 1 into n
    from documents where company_id = d.company_id and number like prefix || '%' and substring(number from length(prefix) + 1) ~ '^\d+$';
  num := prefix || lpad(n::text, 3, '0');
  update documents set number = num, date = coalesce(date, current_date),
    status = case d.kind when 'facture' then 'envoyee' else 'emise' end where id = p_id;
  perform log_action(d.company_id, 'documents', p_id, 'emission', jsonb_build_object('number', num));
  -- note de crédit : la facture d'origine est annulée si elle est entièrement créditée
  if d.kind = 'avoir' and d.source_id is not null then
    select coalesce(sum((l->>'qty')::numeric * (l->>'price')::numeric), 0) into total
      from documents f, jsonb_array_elements(f.lines) l where f.id = d.source_id;
    select coalesce(sum((l->>'qty')::numeric * (l->>'price')::numeric), 0) into credited
      from documents a, jsonb_array_elements(a.lines) l where a.source_id = d.source_id and a.kind = 'avoir' and a.number is not null;
    if credited >= total then update documents set status = 'annulee' where id = d.source_id; end if;
  end if;
  return num;
end $$;
grant execute on function public.issue_document(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════
--  v3 — Console du propriétaire, accès support, supervision
-- ═══════════════════════════════════════════════════════════════

-- Propriétaire(s) de la plateforme : à ajouter une seule fois, à la main (voir README)
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
drop policy if exists "lecture soi" on public.platform_admins;
create policy "lecture soi" on public.platform_admins for select using (user_id = auth.uid());

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from platform_admins where user_id = auth.uid()) $$;

-- Statut commercial et accès support de chaque entreprise
alter table public.companies add column if not exists status text not null default 'actif';
alter table public.companies drop constraint if exists companies_status_check;
alter table public.companies add constraint companies_status_check check (status in ('essai', 'actif', 'suspendu'));
alter table public.companies add column if not exists trial_ends_at date;
alter table public.companies add column if not exists support_allowed boolean not null default true;
alter table public.companies add column if not exists admin_code text unique;   -- code à usage unique pour le 1er responsable

-- Notes internes du propriétaire (jamais visibles par l'entreprise)
create table if not exists public.platform_notes (
  company_id uuid primary key references public.companies on delete cascade,
  notes text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.platform_notes enable row level security;
drop policy if exists "proprietaire" on public.platform_notes;
create policy "proprietaire" on public.platform_notes for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Sessions d'accès support : limitées dans le temps, avec motif, visibles par l'entreprise
create table if not exists public.support_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  company_id uuid not null references public.companies on delete cascade,
  reason text not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours',
  ended_at timestamptz
);
create index if not exists support_sessions_owner on public.support_sessions (owner_id, started_at desc);
alter table public.support_sessions enable row level security;

create or replace function public.support_company() returns uuid
language sql stable security definer set search_path = public as $$
  select s.company_id from support_sessions s join companies c on c.id = s.company_id
  where s.owner_id = auth.uid() and s.ended_at is null and s.expires_at > now() and c.support_allowed
    and exists (select 1 from platform_admins where user_id = auth.uid())
  order by s.started_at desc limit 1
$$;

-- En mode support, le propriétaire agit dans l'entreprise avec les droits d'un responsable.
-- Une entreprise suspendue n'a plus accès à ses données (sauf via le support).
create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(public.support_company(),
    (select p.company_id from profiles p join companies c on c.id = p.company_id where p.id = auth.uid() and c.status <> 'suspendu'))
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.support_company() is not null
    or coalesce((select role = 'admin' from profiles where id = auth.uid() and company_id = public.my_company()), false)
$$;

drop policy if exists "historique support" on public.support_sessions;
create policy "historique support" on public.support_sessions for select
  using (owner_id = auth.uid() or (company_id = public.my_company() and public.is_admin()));

alter table public.audit_log add column if not exists via_support boolean not null default false;
create or replace function public.log_action(p_company uuid, p_table text, p_row uuid, p_action text, p_details jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_log (company_id, actor_id, table_name, row_id, action, details, via_support)
  values (p_company, auth.uid(), p_table, p_row, p_action, p_details, public.support_company() is not null)
$$;
revoke execute on function public.log_action(uuid, text, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.my_company_status() returns text
language sql stable security definer set search_path = public as
$$ select c.status from profiles p join companies c on c.id = p.company_id where p.id = auth.uid() $$;

-- L'entreprise ne peut pas changer elle-même son statut, sa période d'essai ou le code responsable
create or replace function public.guard_company() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' and not public.is_platform_admin()
     and (new.status, new.trial_ends_at, new.admin_code) is distinct from (old.status, old.trial_ends_at, old.admin_code) then
    raise exception 'Réservé au propriétaire de la plateforme.';
  end if;
  return new;
end $$;
drop trigger if exists guard_company on public.companies;
create trigger guard_company before update on public.companies for each row execute function public.guard_company();

-- Démarrer / terminer un accès support
create or replace function public.start_support(p_company uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if not public.is_platform_admin() then raise exception 'Réservé au propriétaire de la plateforme.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Indique le motif de l''accès (ex. appel du client pour…).'; end if;
  if not exists (select 1 from companies where id = p_company and support_allowed) then
    raise exception 'Cette entreprise a désactivé l''accès du support. Demande-lui de le réactiver dans Réglages.';
  end if;
  insert into profiles (id, name, email, role) values (auth.uid(), 'Support Haksou', (select email from auth.users where id = auth.uid()), 'employe')
    on conflict (id) do nothing;
  update support_sessions set ended_at = now() where owner_id = auth.uid() and ended_at is null;
  insert into support_sessions (owner_id, company_id, reason) values (auth.uid(), p_company, trim(p_reason)) returning id into sid;
  perform log_action(p_company, 'support', sid, 'debut', jsonb_build_object('reason', trim(p_reason)));
  return sid;
end $$;

create or replace function public.end_support() returns void
language plpgsql security definer set search_path = public as $$
declare s support_sessions;
begin
  for s in update support_sessions set ended_at = now() where owner_id = auth.uid() and ended_at is null returning * loop
    insert into audit_log (company_id, actor_id, table_name, row_id, action, details, via_support)
    values (s.company_id, auth.uid(), 'support', s.id, 'fin', '{}', true);
  end loop;
end $$;

-- Vue d'ensemble pour la console du propriétaire
create or replace function public.platform_overview()
returns table (id uuid, name text, status text, trial_ends_at date, support_allowed boolean, created_at timestamptz,
  members int, admins int, punches_7d int, documents_30d int, last_activity timestamptz, open_tickets int, errors_7d int, admin_code text, notes text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Réservé au propriétaire de la plateforme.'; end if;
  return query
  select c.id, c.name, c.status, c.trial_ends_at, c.support_allowed, c.created_at,
    (select count(*)::int from profiles p where p.company_id = c.id),
    (select count(*)::int from profiles p where p.company_id = c.id and p.role = 'admin'),
    (select count(*)::int from punches x where x.company_id = c.id and x.at > now() - interval '7 days'),
    (select count(*)::int from documents x where x.company_id = c.id and x.created_at > now() - interval '30 days'),
    greatest((select max(x.at) from punches x where x.company_id = c.id), (select max(x.at) from audit_log x where x.company_id = c.id and not x.via_support),
      (select max(x.created_at) from documents x where x.company_id = c.id)),
    (select count(*)::int from support_tickets t where t.company_id = c.id and t.status = 'ouvert'),
    (select count(*)::int from error_reports e where e.company_id = c.id and e.at > now() - interval '7 days'),
    c.admin_code, coalesce((select n.notes from platform_notes n where n.company_id = c.id), '')
  from companies c order by c.created_at desc;
end $$;

create or replace function public.platform_create_company(p_name text, p_trial_days int default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c companies;
begin
  if not public.is_platform_admin() then raise exception 'Réservé au propriétaire de la plateforme.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Indique le nom de l''entreprise.'; end if;
  insert into companies (name, status, trial_ends_at, admin_code)
  values (trim(p_name), case when p_trial_days > 0 then 'essai' else 'actif' end,
          case when p_trial_days > 0 then current_date + p_trial_days end, upper(substr(md5(random()::text), 1, 8)))
  returning * into c;
  return jsonb_build_object('id', c.id, 'admin_code', c.admin_code, 'join_code', c.join_code);
end $$;

create or replace function public.platform_set_company(p_id uuid, p_status text, p_trial_ends_at date, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Réservé au propriétaire de la plateforme.'; end if;
  update companies set status = p_status, trial_ends_at = p_trial_ends_at where id = p_id;
  insert into platform_notes (company_id, notes, updated_at) values (p_id, coalesce(p_notes, ''), now())
    on conflict (company_id) do update set notes = excluded.notes, updated_at = now();
end $$;

-- Rejoindre : le code responsable (à usage unique) donne le rôle de responsable
create or replace function public.join_company(p_code text, p_user_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; as_admin boolean; code text := upper(trim(p_code));
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if exists (select 1 from profiles where id = auth.uid() and company_id is not null) then
    raise exception 'Tu fais déjà partie d''une entreprise.';
  end if;
  select id, admin_code = code into cid, as_admin from companies where join_code = code or admin_code = code;
  if cid is null then raise exception 'Code d''entreprise inconnu. Vérifie-le auprès de ton responsable.'; end if;
  insert into profiles (id, company_id, name, email, role)
  values (auth.uid(), cid, trim(p_user_name), (select email from auth.users where id = auth.uid()), case when as_admin then 'admin' else 'employe' end)
  on conflict (id) do update set company_id = cid, name = excluded.name, role = excluded.role;
  if as_admin then update companies set admin_code = null where id = cid; end if;
  return cid;
end $$;

-- Remontée automatique des erreurs de l'appli
create table if not exists public.error_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid default public.my_company() references public.companies on delete cascade,
  user_id uuid default auth.uid() references auth.users on delete set null,
  message text not null check (length(message) <= 2000),
  stack text check (length(stack) <= 8000),
  url text check (length(url) <= 500),
  user_agent text check (length(user_agent) <= 500),
  app_version text,
  resolved boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists error_reports_at on public.error_reports (at desc);
alter table public.error_reports enable row level security;
drop policy if exists "envoi" on public.error_reports;
drop policy if exists "proprietaire" on public.error_reports;
create policy "envoi" on public.error_reports for insert with check (user_id = auth.uid() and (company_id is null or company_id = public.my_company()));
create policy "proprietaire" on public.error_reports for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Demandes d'aide des utilisateurs
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company() references public.companies on delete cascade,
  user_id uuid default auth.uid() references public.profiles on delete set null,
  message text not null check (length(message) between 1 and 4000),
  context text default '',
  status text not null default 'ouvert' check (status in ('ouvert', 'resolu')),
  reply text default '',
  replied_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.support_tickets enable row level security;
drop policy if exists "envoi" on public.support_tickets;
drop policy if exists "lecture" on public.support_tickets;
drop policy if exists "reponse" on public.support_tickets;
create policy "envoi" on public.support_tickets for insert with check (company_id = public.my_company() and user_id = auth.uid() and status = 'ouvert');
create policy "lecture" on public.support_tickets for select using (public.is_platform_admin() or (company_id = public.my_company() and (user_id = auth.uid() or public.is_admin())));
create policy "reponse" on public.support_tickets for update using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Pointages hors ligne : envoyés plus tard avec l'heure du téléphone, signalés comme tels
alter table public.punches add column if not exists offline boolean not null default false;
create or replace function public.punch_guard() returns trigger
language plpgsql set search_path = public as $$
declare can_edit boolean := public.is_admin()
  or coalesce((select punch_self_edit from companies where id = coalesce(new.company_id, old.company_id)), true);
begin
  if tg_op = 'INSERT' then
    new.deleted := false; new.edited := false;
    if new.offline then
      if new.at < now() - interval '48 hours' or new.at > now() + interval '5 minutes' then
        raise exception 'Pointage hors ligne trop ancien : ajoute-le comme pointage oublié.';
      end if;
      new.manual := false;
      return new;
    end if;
    new.manual := abs(extract(epoch from (new.at - now()))) > 300;
    if new.manual and not can_edit then raise exception 'Ton responsable a désactivé les corrections de pointage.'; end if;
    if new.manual and coalesce(trim(new.note), '') = '' then raise exception 'Indique le motif de ce pointage oublié.'; end if;
    return new;
  end if;
  if not can_edit then raise exception 'Ton responsable a désactivé les corrections de pointage.'; end if;
  if old.deleted and not public.is_admin() then raise exception 'Ce pointage a été supprimé.'; end if;
  if (new.at, new.type, new.deleted) is distinct from (old.at, old.type, old.deleted) and coalesce(trim(new.note), '') = '' then
    raise exception 'Indique le motif de la correction.';
  end if;
  new.user_id := old.user_id; new.company_id := old.company_id; new.manual := old.manual; new.offline := old.offline;
  new.edited := old.edited or (new.at, new.type) is distinct from (old.at, old.type);
  return new;
end $$;

create or replace function public.punch_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.manual then
      perform log_action(new.company_id, 'punches', new.id, 'ajout', jsonb_build_object('user_id', new.user_id, 'type', new.type, 'at', new.at, 'note', new.note));
    elsif new.offline and abs(extract(epoch from (new.at - now()))) > 300 then
      perform log_action(new.company_id, 'punches', new.id, 'hors_ligne', jsonb_build_object('user_id', new.user_id, 'type', new.type, 'at', new.at, 'recu', now()));
    end if;
  elsif (new.at, new.type, new.deleted) is distinct from (old.at, old.type, old.deleted) then
    perform log_action(new.company_id, 'punches', new.id, case when new.deleted and not old.deleted then 'suppression' else 'modification' end,
      jsonb_build_object('user_id', new.user_id, 'type_avant', old.type, 'type', new.type, 'at_avant', old.at, 'at', new.at, 'note', new.note));
  end if;
  return null;
end $$;

-- Demandes d'aide et erreurs de toutes les entreprises, pour la console
create or replace function public.platform_tickets()
returns table (id uuid, company_id uuid, company_name text, user_id uuid, user_name text, user_email text, message text, context text,
  status text, reply text, replied_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Réservé au propriétaire de la plateforme.'; end if;
  return query select t.id, t.company_id, c.name, t.user_id, p.name, p.email, t.message, t.context, t.status, t.reply, t.replied_at, t.created_at
    from support_tickets t join companies c on c.id = t.company_id left join profiles p on p.id = t.user_id
    order by (t.status = 'ouvert') desc, t.created_at desc limit 500;
end $$;

create or replace function public.platform_errors()
returns table (id uuid, company_id uuid, company_name text, user_id uuid, user_name text, message text, stack text, url text,
  user_agent text, app_version text, resolved boolean, at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Réservé au propriétaire de la plateforme.'; end if;
  return query select e.id, e.company_id, coalesce(c.name, '—'), e.user_id, coalesce(p.name, '—'), e.message, e.stack, e.url, e.user_agent, e.app_version, e.resolved, e.at
    from error_reports e left join companies c on c.id = e.company_id left join profiles p on p.id = e.user_id
    order by e.at desc limit 1000;
end $$;

grant execute on function public.platform_tickets(), public.platform_errors() to authenticated;
grant execute on function public.start_support(uuid, text), public.end_support(), public.platform_overview(),
  public.platform_create_company(text, int), public.platform_set_company(uuid, text, date, text), public.my_company_status(),
  public.is_platform_admin() to authenticated;
