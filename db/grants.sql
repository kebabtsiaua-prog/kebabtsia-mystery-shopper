-- Надати службовій ролі доступ до таблиць (нові sb_secret-ключі мапляться на service_role,
-- але новоствореним таблицям бракує grant-ів → "permission denied for table ...").
-- Запускати один раз у Supabase → SQL Editor після schema.sql.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
