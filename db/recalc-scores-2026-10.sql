-- Перерахунок балів у всіх збережених звітах за новими правилами (жовтень 2026):
--  • «Допоміг з вибором» і «Дав опис складу кебабу» тепер дають по 2 бали;
--  • у ТЦ (немає свого туалету) питання про туалет не рахується і прибирається зі звіту.
-- Ваги мають збігатися з SECTIONS у index.html.
-- Запуск: Supabase → SQL Editor → вставити весь файл → Run.

-- 1) Резервна копія старих значень (якщо щось піде не так — можна відновити)
create table if not exists public.reports_backup_20261022 as
  select id, answers, score_pct, score_earned, score_max, section_scores from public.reports;

-- 2) У ТЦ прибираємо відповідь про туалет
update public.reports
set answers = answers - 'toilet_clean' - 'toilet_clean_detail'
where location_name in ('Гетьмана Мазепи 1б (ТРЦ Спартак)','Форум Львів','Victoria Gardens','Чорновола 16і');

-- 3) Перераховуємо бали: «Так» = повна вага, «Ні» = 0, без відповіді — питання не рахується
with w(sec, k, pts) as (values
  ('reception','greeted',3), ('reception','smiled',3), ('reception','helped_choice',2),
  ('reception','offered_extra',5), ('reception','desc_kebab',2), ('reception','asked_app',2),
  ('reception','offered_app_reg',3),
  ('payout','repeated_order',2), ('payout','receipt_match',2), ('payout','said_smachnoho',3),
  ('quality','packed_well',2), ('quality','temp_ok',2), ('quality','looks_appetizing',2),
  ('staff','staff_neat',2), ('staff','staff_clothes',2), ('staff','staff_attentive',2),
  ('clean','facade_clean',1), ('clean','trash_clean',1), ('clean','floor_clean',2),
  ('clean','tables_clean',2), ('clean','furniture_neat',2), ('clean','comfort_temp',2),
  ('clean','toilet_clean',2)
),
per_sec as (
  select r.id, w.sec,
    coalesce(sum(w.pts) filter (where r.answers->>w.k in ('yes','no')), 0) as mx,
    coalesce(sum(w.pts) filter (where r.answers->>w.k = 'yes'), 0) as er
  from public.reports r cross join w
  group by r.id, w.sec
),
tot as (
  select id, sum(er)::int as e, sum(mx)::int as m,
    jsonb_object_agg(sec, jsonb_build_object('earned', er, 'max', mx)) as ss
  from per_sec group by id
)
update public.reports r
set score_earned = tot.e, score_max = tot.m, section_scores = tot.ss,
    score_pct = case when tot.m > 0 then round(tot.e * 100.0 / tot.m, 2) else 0 end
from tot where tot.id = r.id;

-- 4) Що змінилось (старий → новий бал)
select r.period, r.location_name, b.score_pct as old_pct, r.score_pct as new_pct,
       r.score_earned || '/' || r.score_max as new_points
from public.reports r join public.reports_backup_20261022 b using (id)
order by r.period desc, r.location_name;
