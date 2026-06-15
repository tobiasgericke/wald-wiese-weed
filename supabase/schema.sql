-- Festival App Schema
-- Stand: initial setup (korrigierte RLS-Policies ohne veraltetes auth.role())

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.festival_config (
  id integer primary key default 1,
  festival_name text not null default 'Unser Festival',
  festival_date date,
  location text,
  bank_name text,
  bank_iban text,
  bank_recipient text,
  payment_deadline date,
  notes text,
  constraint single_row check (id = 1)
);

create table public.cost_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric(10,2) not null default 0,
  description text,
  created_at timestamptz not null default now()
);

create table public.participant_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_due numeric(10,2) not null default 0,
  amount_paid numeric(10,2) not null default 0,
  paid boolean not null default false,
  paid_at timestamptz,
  notes text,
  unique(user_id)
);

-- RLS
alter table public.profiles enable row level security;
alter table public.festival_config enable row level security;
alter table public.cost_items enable row level security;
alter table public.participant_payments enable row level security;

-- Admin-Hilfsfunktion
create or replace function public.is_admin()
returns boolean language sql security invoker stable as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_admin = true
  )
$$;

-- Grants (ohne diese bekommen alle Anfragen 403 trotz RLS-Policies)
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.festival_config to authenticated;
grant select, insert, update, delete on public.cost_items to authenticated;
grant select, insert, update, delete on public.participant_payments to authenticated;
grant select, insert, update, delete on public.attendance to authenticated;
grant execute on function public.is_admin() to authenticated;

-- Profiles
create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_select_admin" on public.profiles for select to authenticated using (public.is_admin());
create policy "profiles_update_admin" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Festival Config
create policy "config_select_auth" on public.festival_config for select to authenticated using (true);
create policy "config_insert_admin" on public.festival_config for insert to authenticated with check (public.is_admin());
create policy "config_update_admin" on public.festival_config for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Cost Items
create policy "costs_select_auth" on public.cost_items for select to authenticated using (true);
create policy "costs_insert_admin" on public.cost_items for insert to authenticated with check (public.is_admin());
create policy "costs_update_admin" on public.cost_items for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "costs_delete_admin" on public.cost_items for delete to authenticated using (public.is_admin());

-- Participant Payments
create policy "payments_select_own" on public.participant_payments for select to authenticated using ((select auth.uid()) = user_id);
create policy "payments_select_admin" on public.participant_payments for select to authenticated using (public.is_admin());
create policy "payments_insert_admin" on public.participant_payments for insert to authenticated with check (public.is_admin());
create policy "payments_update_admin" on public.participant_payments for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "payments_delete_admin" on public.participant_payments for delete to authenticated using (public.is_admin());

-- Nach erstem Login: Admin setzen
-- update public.profiles set is_admin = true where email = 'deine@email.de';
