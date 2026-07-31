-- ============================================================
--  Кебабця · Таємний покупець — структура бази (Supabase / Postgres)
--  Запускати один раз у Supabase → SQL Editor.
-- ============================================================

-- ЛОКАЦІЇ (керований список для випадачки)
create table if not exists public.locations (
  id         bigint generated always as identity primary key,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ЗАПРОШЕНІ ПОКУПЦІ та адміни (це і є «замок» — лише ці люди мають доступ)
create table if not exists public.shoppers (
  telegram_id bigint primary key,
  full_name   text,
  username    text,
  is_admin    boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ЗАВДАННЯ (одноразові): кого, куди й на який період призначено перевірити
create table if not exists public.assignments (
  id          bigint generated always as identity primary key,
  shopper_id  bigint not null references public.shoppers(telegram_id),
  location_id bigint not null references public.locations(id),
  period      text not null,                 -- напр. '2026-08'
  status      text not null default 'open',  -- 'open' | 'done'
  created_at  timestamptz not null default now()
);

-- ЗВІТИ (самі відповіді + бал + фото)
create table if not exists public.reports (
  id             bigint generated always as identity primary key,
  assignment_id  bigint references public.assignments(id),
  shopper_id     bigint not null references public.shoppers(telegram_id),
  location_id    bigint references public.locations(id),
  location_name  text,
  period         text,
  answers        jsonb not null,     -- повний запис форми
  score_pct      numeric,
  score_earned   int,
  score_max      int,
  section_scores jsonb,
  photos         jsonb,              -- слот -> шлях у сховищі
  created_at     timestamptz not null default now()
);

-- RLS: замикаємо все. Публічний ключ у браузері не має доступу ні до чого.
-- Дані читає/пише лише Edge Function через service role (він обходить RLS).
alter table public.locations   enable row level security;
alter table public.shoppers    enable row level security;
alter table public.assignments enable row level security;
alter table public.reports     enable row level security;

-- Приватне сховище для фото
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

-- ------------------------------------------------------------
--  ПОЧАТКОВІ ДАНІ
-- ------------------------------------------------------------

-- 21 локація
insert into public.locations (name) values
  ('Гетьмана Мазепи 1б (ТРЦ Спартак)'),
  ('Хуторівка 4Б'),
  ('Княгині Ольги 100Л'),
  ('Шевченка 309'),
  ('Героїв УПА 73'),
  ('Валова 13'),
  ('Нижній Шувар'),
  ('Шевченка 60 (БЦ Семицвіт)'),
  ('Червоної Калини 109'),
  ('Форум Львів'),
  ('Victoria Gardens'),
  ('Сокільники (Франка бічна 2)'),
  ('Крива Липа 8'),
  ('Чернівецька 13/15'),
  ('Левандівка'),
  ('Львів Рясне'),
  ('Чорновола 16і'),
  ('Дрогобич'),
  ('Тернопіль'),
  ('Шептицький (Героїв Майдану 10)'),
  ('Чернівці (Небесної сотні 19)');

-- Адмін / тестовий покупець: Назар
insert into public.shoppers (telegram_id, full_name, username, is_admin)
values (395826501, 'Назар Дмитренко', 'nazik_dnk', true)
on conflict (telegram_id) do update set is_admin = true, active = true;

-- Тестове завдання для Назара, щоб пройти форму (локація «Мазепи», період 2026-08)
insert into public.assignments (shopper_id, location_id, period)
select 395826501, id, '2026-08'
from public.locations
where name = 'Гетьмана Мазепи 1б (ТРЦ Спартак)';
