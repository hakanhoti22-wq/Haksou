-- Factures (émission, verrouillage, notes de crédit) et journal des pointages. Base neuve : 0-simulation-supabase.sql puis schema.sql puis ce fichier.
\set ON_ERROR_STOP 0
\set boss '11111111-1111-1111-1111-111111111111'
\set emp '22222222-2222-2222-2222-222222222222'
set role authenticated;
select set_config('request.jwt.claim.sub', :'boss', false) \g /dev/null
select create_company('Entreprise A', 'Boss') is not null as created;
select join_code as code_a from companies \gset
select set_config('request.jwt.claim.sub', :'emp', false) \g /dev/null
select join_company(:'code_a', 'Employé') is not null as joined;

\echo '--- POINTAGES (employé)'
insert into punches(type) values ('in') returning manual;                                   -- normal
insert into punches(type, at) values ('out', now() - interval '3 hours');                    -- ERREUR : motif manquant
insert into punches(type, at, note) values ('out', now() - interval '3 hours', 'oubli') returning manual;
select id as pid from punches where not manual limit 1 \gset
update punches set at = at - interval '20 min' where id = :'pid';                             -- ERREUR : motif manquant
update punches set at = at - interval '20 min', note = 'badge en retard' where id = :'pid' returning edited;
update punches set user_id = :'boss', note='x', at = at where id = :'pid' returning user_id = :'emp' as user_inchange;
delete from punches where id = :'pid';                                                        -- 0 ligne (pas de droit)
update punches set deleted = true, note = 'doublon' where id = :'pid' returning deleted;
insert into audit_log(company_id, table_name, row_id, action) select company_id, 'x', id, 'faux' from punches limit 1; -- ERREUR RLS
select action, details->>'note' as motif from audit_log order by at;

\echo '--- le patron interdit les corrections'
select set_config('request.jwt.claim.sub', :'boss', false) \g /dev/null
update companies set punch_self_edit = false returning punch_self_edit;
select count(*) as journal_vu_par_boss from audit_log;
select set_config('request.jwt.claim.sub', :'emp', false) \g /dev/null
insert into punches(type, at, note) values ('in', now() - interval '1 day', 'oubli');          -- ERREUR : désactivé
insert into punches(type) values ('out') returning manual;                                     -- OK : pointage normal

\echo '--- FACTURES'
insert into clients(name) values ('Client 1');
insert into documents(kind, number, status, client_id, lines, vat)
  select 'facture', 'F-2026-999', 'payee', id, '[{"desc":"Travail","qty":2,"price":100}]', 8.1 from clients returning number is null as sans_numero, status;
select id as fid from documents where kind = 'facture' \gset
update documents set number = 'F-2026-001' where id = :'fid';                                 -- ERREUR : passer par Émettre
update documents set status = 'payee' where id = :'fid';                                       -- ERREUR : émettre d'abord
select issue_document(:'fid');
select issue_document(:'fid');                                                                 -- ERREUR : déjà émise
update documents set lines = '[]' where id = :'fid';                                           -- ERREUR : verrouillée
update documents set notes = 'modif' where id = :'fid';                                        -- ERREUR : verrouillée
delete from documents where id = :'fid';                                                       -- ERREUR : suppression interdite
update documents set status = 'payee', paid_at = current_date where id = :'fid' returning status;  -- OK
-- deuxième facture : brouillon supprimé = pas de trou
insert into documents(kind, client_id, lines) select 'facture', id, '[{"desc":"A","qty":1,"price":50}]' from clients returning id as f2 \gset
delete from documents where id = :'f2' returning 'brouillon supprimé' as ok;
insert into documents(kind, client_id, lines) select 'facture', id, '[{"desc":"B","qty":1,"price":80}]' from clients returning id as f3 \gset
select issue_document(:'f3') as numero_suivant;
-- note de crédit partielle puis totale
insert into documents(kind, client_id, source_id, lines) select 'avoir', client_id, id, '[{"desc":"Geste","qty":1,"price":50}]' from documents where id = :'fid' returning id as a1 \gset
select issue_document(:'a1') as avoir1;
select status from documents where id = :'fid';
insert into documents(kind, client_id, source_id, lines) select 'avoir', client_id, id, '[{"desc":"Solde","qty":1,"price":150}]' from documents where id = :'fid' returning id as a2 \gset
select issue_document(:'a2') as avoir2;
select status as statut_facture_apres_credit_total from documents where id = :'fid';
-- devis : libre
insert into documents(kind, number, lines) values ('devis', 'D-2026-001', '[]') returning id as d1 \gset
update documents set lines = '[{"desc":"x","qty":1,"price":1}]', status = 'envoye' where id = :'d1' returning status;
delete from documents where id = :'d1' returning 'devis supprimé' as ok;
select action, details from audit_log where table_name = 'documents' order by at;
reset role;
select kind, number, status from documents order by created_at;
