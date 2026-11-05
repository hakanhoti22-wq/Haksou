-- Console du propriétaire, accès support, suspension, erreurs et demandes d'aide.
-- Base neuve : 0-simulation-supabase.sql puis schema.sql puis ce fichier.
\set ON_ERROR_STOP 0
\set boss '11111111-1111-1111-1111-111111111111'
\set emp '22222222-2222-2222-2222-222222222222'
\set owner '33333333-3333-3333-3333-333333333333'
insert into platform_admins (user_id) values (:'owner');
set role authenticated;

\echo '--- le propriétaire crée une entreprise cliente'
select set_config('request.jwt.claim.sub', :'owner', false) \g /dev/null
select r ->> 'admin_code' as admin_code, r ->> 'id' as cid from platform_create_company('Garage Test', 30) r \gset
select name, status, trial_ends_at > current_date as essai from platform_overview();
select count(*) as entreprises_lisibles_directement from companies;           -- 0 : uniquement via les fonctions du propriétaire

\echo '--- le patron rejoint avec le code responsable (usage unique)'
select set_config('request.jwt.claim.sub', :'boss', false) \g /dev/null
select join_company(:'admin_code', 'Boss') is not null as joined;
select role from profiles where id = :'boss';
select admin_code is null as code_responsable_consomme, join_code as code_emp from companies \gset
select :'code_responsable_consomme' as code_responsable_consomme;
select set_config('request.jwt.claim.sub', :'emp', false) \g /dev/null
select join_company(:'admin_code', 'Pirate');                                -- ERREUR : code déjà utilisé
select join_company(:'code_emp', 'Employé') is not null as employe_joint;
select role from profiles where id = :'emp';
select platform_overview();                                                   -- ERREUR : réservé au propriétaire
select start_support(:'cid', 'test');                                     -- ERREUR : réservé au propriétaire
insert into error_reports (message, url) values ('TypeError: x is undefined', '/gestion/#/pointage');
insert into support_tickets (message) values ('Je n''arrive pas à émettre ma facture');
select count(*) as erreurs_visibles_par_employe from error_reports;          -- 0

\echo '--- le patron ne peut pas changer son statut ni sa période d''essai'
select set_config('request.jwt.claim.sub', :'boss', false) \g /dev/null
update companies set status = 'actif';                                        -- ERREUR : réservé au propriétaire
update companies set support_allowed = false returning support_allowed;      -- OK : c'est son choix
select count(*) as ticket_vu_par_patron from support_tickets;               -- 1

\echo '--- le propriétaire : vue d''ensemble, support refusé puis autorisé'
select set_config('request.jwt.claim.sub', :'owner', false) \g /dev/null
select name, members, admins, open_tickets, errors_7d from platform_overview();
select count(*) as pointages_vus_sans_support from punches;                  -- 0 : rien sans session
select start_support(:'cid', 'Appel du client');       -- ERREUR : support désactivé
select set_config('request.jwt.claim.sub', :'boss', false) \g /dev/null
update companies set support_allowed = true returning support_allowed;      -- le patron réautorise le support
select set_config('request.jwt.claim.sub', :'owner', false) \g /dev/null
select start_support(:'cid', '');                         -- ERREUR : motif obligatoire
select start_support(:'cid', 'Appel du client : facture bloquée') is not null as session_ouverte;
select is_admin() as droits_responsable, my_company() = :'cid' as dans_entreprise;
select count(*) as membres_vus from profiles where company_id = my_company();
insert into clients (name) values ('Client ajouté par le support') returning name;
update support_tickets set status = 'resolu', reply = 'Corrigé, merci !', replied_at = now() returning status;
select end_support();
select count(*) as clients_vus_apres_fin from clients;                        -- 0 : session terminée

\echo '--- le patron voit l''historique du support dans son journal'
select set_config('request.jwt.claim.sub', :'boss', false) \g /dev/null
select action, via_support, details ->> 'reason' as motif from audit_log where table_name = 'support' order by at;
select reason, ended_at is not null as terminee from support_sessions;
select reply from support_tickets;

\echo '--- suspension'
select set_config('request.jwt.claim.sub', :'owner', false) \g /dev/null
select platform_set_company(:'cid', 'suspendu', null, 'Facture impayée');
select set_config('request.jwt.claim.sub', :'emp', false) \g /dev/null
select my_company_status();
select count(*) as clients_vus_suspendu from clients;                        -- 0
insert into punches (type) values ('in');                                     -- ERREUR : entreprise suspendue
select set_config('request.jwt.claim.sub', :'owner', false) \g /dev/null
select notes from platform_overview();
select platform_set_company(:'cid', 'actif', null, 'Payé le ' || current_date);
select set_config('request.jwt.claim.sub', :'emp', false) \g /dev/null
insert into punches (type) values ('in') returning type;                      -- OK : réactivée

\echo '--- pointage hors ligne'
insert into punches (type, at, offline) values ('out', now() - interval '2 hours', true) returning manual, offline;
insert into punches (type, at, offline) values ('in', now() - interval '3 days', true);   -- ERREUR : trop ancien
select action from audit_log where table_name = 'punches';
reset role;
