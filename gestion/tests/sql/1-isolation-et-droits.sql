-- Isolation entre entreprises et droits patron / employé. Base neuve : 0-simulation-supabase.sql puis schema.sql puis ce fichier.
\set ON_ERROR_STOP 0
\set boss '11111111-1111-1111-1111-111111111111'
\set emp '22222222-2222-2222-2222-222222222222'
\set oth '33333333-3333-3333-3333-333333333333'
set role authenticated;
-- patron crée l'entreprise A
select set_config('request.jwt.claim.sub', :'boss', false);
select create_company('Entreprise A', 'Boss') is not null as created;
select join_code as code_a from companies \gset
-- employé rejoint A
select set_config('request.jwt.claim.sub', :'emp', false);
select join_company(:'code_a', 'Employé') is not null as joined;
select join_company('XXXXXX', 'x');   -- doit échouer (déjà membre)
-- autre personne crée B
select set_config('request.jwt.claim.sub', :'oth', false);
select create_company('Entreprise B', 'Other') is not null as created_b;
insert into clients(name) values ('Client de B');
-- employé : pointage, congé, frais
select set_config('request.jwt.claim.sub', :'emp', false);
insert into punches(type) values ('in');
insert into leaves(start_date,end_date) values (current_date, current_date);
insert into leaves(start_date,end_date,status) values (current_date, current_date,'approuve');  -- doit échouer
insert into expenses(amount) values (12.5);
update expenses set status='validee';  -- doit échouer
insert into shifts(user_id,date,start_time,end_time) values (:'emp',current_date,'08:00','12:00'); -- doit échouer
update profiles set role='admin' where id=:'emp';  -- 0 ligne (pas admin)
select role from profiles where id=:'emp';
select count(*) as clients_visibles_par_emp_A from clients;
insert into clients(name) values ('Client de A');
-- patron
select set_config('request.jwt.claim.sub', :'boss', false);
select count(*) as punches_vus_par_boss from punches;
update leaves set status='approuve' returning status;
update expenses set status='validee' returning status;
insert into shifts(user_id,date,start_time,end_time) values (:'emp',current_date,'08:00','12:00') returning start_time;
select count(*) as clients_vus_boss_A from clients;
update profiles set company_id = (select id from companies limit 1) where id=:'emp'; -- ok (même entreprise, pas de changement)
update profiles set role='employe' where id=:'boss'; -- doit échouer (dernier responsable)
update companies set name='Entreprise A Sàrl' returning name;
insert into documents(kind,number,lines) values ('facture','F-2026-001','[{"desc":"x","qty":1,"price":10}]') returning number;
insert into items(name,qty) values ('Tube',5) returning name;
insert into movements(item_id,delta) select id,-1 from items returning delta;
insert into interventions(title) values ('Test') returning title;
-- employé B ne voit rien de A
select set_config('request.jwt.claim.sub', :'oth', false);
select count(*) as punches_vus_par_B from punches;
select count(*) as profils_vus_par_B from profiles;
select count(*) as docs_vus_par_B from documents;
update companies set name='piratage' where name like 'Entreprise A%'; -- 0 ligne
-- employé A voit congés approuvés, pas les frais des autres
select set_config('request.jwt.claim.sub', :'emp', false);
delete from leaves; -- doit échouer (déjà traitée)
select count(*) as shifts_vus_emp from shifts;
-- patron retire l'employé
select set_config('request.jwt.claim.sub', :'boss', false);
select remove_member(:'emp');
select count(*) as membres_restants from profiles;
reset role;
select name, company_id is null as sans_entreprise from profiles order by name;
