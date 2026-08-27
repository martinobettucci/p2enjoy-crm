-- Fichier temporaire créé par scripts/verify-harness.sh, supprimé par son trap.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
select ok(true, 'assertion hors savepoint');
savepoint s1;
select ok(true, 'assertion dans un savepoint annule');
select ok(true, 'derniere assertion, dans le meme savepoint');
rollback to s1;
select * from finish();
rollback;
