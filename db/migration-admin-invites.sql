-- Запрошення адмінів за одноразовим кодом (2026-10-26)
-- Головний адмін у кабінеті створює запрошення (ім'я + роль) → бот дає посилання
-- t.me/<бот>?start=КОД. Людина тисне «Старт» → бот записує її в shoppers і код згорає.
-- Запускати один раз у Supabase → SQL Editor.
alter table public.shoppers add column if not exists is_super boolean not null default false;

create table if not exists public.admin_invites (
  code       text primary key,
  full_name  text not null,
  is_super   boolean not null default false,   -- true = головний адмін (керує адмінами)
  created_by bigint,
  created_at timestamptz not null default now(),
  used_by    bigint,                           -- Telegram ID того, хто відкрив посилання
  used_at    timestamptz                       -- не null = код уже згорів
);
alter table public.admin_invites enable row level security;
grant all privileges on public.admin_invites to service_role;
