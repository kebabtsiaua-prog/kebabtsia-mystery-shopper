-- Сповіщення адмінам про нові перевірки + екскурсія по кабінету (2026-10-29)
-- Запускати один раз у Supabase → SQL Editor.
alter table public.shoppers add column if not exists notify       boolean not null default false; -- бот пише про кожен новий звіт
alter table public.shoppers add column if not exists tour_done_at timestamptz;                    -- коли адмін пройшов екскурсію
