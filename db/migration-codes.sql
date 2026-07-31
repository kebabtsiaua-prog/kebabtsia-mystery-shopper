-- Перехід на доступ за кодами (2026-07-31)
-- Покупці більше не з таблиці shoppers (там лишаються тільки адміни).
-- Доступ = одноразовий код у assignments, прив'язаний до локації.
alter table public.assignments drop constraint if exists assignments_shopper_id_fkey;
alter table public.assignments alter column shopper_id drop not null;
alter table public.assignments add column if not exists code text unique;
alter table public.assignments add column if not exists used_at timestamptz;
alter table public.reports drop constraint if exists reports_shopper_id_fkey;
alter table public.reports add column if not exists shopper_name text;
