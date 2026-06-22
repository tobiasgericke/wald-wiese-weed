-- Festival App Schema
-- Vollständiger Stand der produktiven Datenbank (aus DB rekonstruiert).
-- Reihenfolge respektiert FK-Abhängigkeiten. Bei Neuaufbau in dieser Reihenfolge ausführen.

-- ──────────────────────────────────────────────────────────────────────────────
-- Tabellen
-- ──────────────────────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  first_name text,
  last_name text
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
  festival_start date,
  num_days integer not null default 4,
  daily_rate numeric(10,2) not null default 25.00,
  guest_daily_rate numeric(10,2) not null default 15.00,
  payment_reference text,
  donation_org1_name text,
  donation_org1_url text,
  donation_org1_description text,
  donation_org2_name text,
  donation_org2_url text,
  donation_org2_description text,
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

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_index integer not null,
  present boolean not null default false,
  -- genau eine Zeile pro User pro Tag; Client nutzt upsert mit onConflict
  unique(user_id, day_index)
);

create table public.legacy_credits (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  amount_owed numeric(10,2) not null,
  matched_user_id uuid references public.profiles(id) on delete set null,
  match_confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.legacy_credit_requests (
  id uuid primary key default gen_random_uuid(),
  legacy_credit_id uuid not null references public.legacy_credits(id) on delete cascade,
  requesting_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  created_at timestamptz not null default now()
);

-- Höchstens eine offene Anfrage pro User
create unique index one_pending_request_per_user
  on public.legacy_credit_requests (requesting_user_id)
  where (status = 'pending');

create table public.legacy_credit_decisions (
  id uuid primary key default gen_random_uuid(),
  legacy_credit_id uuid not null references public.legacy_credits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  decision text not null check (decision in ('refund', 'apply_www7', 'donate_www', 'donate_org1', 'donate_org2')),
  decided_at timestamptz not null default now(),
  unique(legacy_credit_id)
);

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS aktivieren
-- ──────────────────────────────────────────────────────────────────────────────

alter table public.profiles               enable row level security;
alter table public.festival_config        enable row level security;
alter table public.cost_items             enable row level security;
alter table public.participant_payments   enable row level security;
alter table public.attendance             enable row level security;
alter table public.legacy_credits         enable row level security;
alter table public.legacy_credit_requests enable row level security;
alter table public.legacy_credit_decisions enable row level security;

-- ──────────────────────────────────────────────────────────────────────────────
-- Funktionen
-- ──────────────────────────────────────────────────────────────────────────────

-- Admin-Hilfsfunktion
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_admin = true
  )
$$;

-- Legt nach Signup automatisch ein Profil an (Trigger auf auth.users)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_first_name text;
  v_last_name  text;
  v_full_name  text;
begin
  v_first_name := coalesce(nullif(trim(new.raw_user_meta_data->>'first_name'), ''), split_part(new.email, '@', 1));
  v_last_name  := coalesce(nullif(trim(new.raw_user_meta_data->>'last_name'),  ''), '');
  v_full_name  := trim(concat(v_first_name, ' ', v_last_name));

  insert into public.profiles (id, email, name, first_name, last_name)
  values (new.id, new.email, v_full_name, v_first_name, v_last_name);

  return new;
end;
$$;

-- Versucht, ein Altguthaben automatisch über den Namen dem aktuellen User zuzuordnen
create or replace function public.try_automatch_legacy_credit()
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid  uuid := auth.uid();
  v_fn   text;
  v_ln   text;
  v_full text;
  v_credit legacy_credits%rowtype;
begin
  -- Schon zugeordnet?
  select * into v_credit from legacy_credits where matched_user_id = v_uid limit 1;
  if found then
    return json_build_object(
      'status','already_matched',
      'credit_id', v_credit.id,
      'amount', v_credit.amount_owed,
      'display_name', v_credit.display_name,
      'confirmed', v_credit.match_confirmed
    );
  end if;

  -- Vollständigen Namen aus Profil bilden
  select coalesce(nullif(trim(first_name),''),''),
         coalesce(nullif(trim(last_name),''),'')
    into v_fn, v_ln
    from profiles where id = v_uid;
  v_full := trim(v_fn || ' ' || v_ln);

  if v_full = '' then
    return json_build_object('status','no_match');
  end if;

  -- Case-insensitive exakter Treffer auf noch nicht zugeordnete Guthaben
  select * into v_credit from legacy_credits
  where matched_user_id is null
    and lower(trim(display_name)) = lower(v_full)
  limit 1;

  if found then
    update legacy_credits
      set matched_user_id = v_uid, match_confirmed = true
      where id = v_credit.id;
    return json_build_object(
      'status','matched',
      'credit_id', v_credit.id,
      'amount', v_credit.amount_owed,
      'display_name', v_credit.display_name
    );
  end if;

  return json_build_object('status','no_match');
end;
$$;

-- User reicht eine Zuordnungs-Anfrage für ein Altguthaben ein
create or replace function public.submit_legacy_credit_request(p_credit_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (select 1 from legacy_credits where id = p_credit_id and matched_user_id is null) then
    return json_build_object('error','Dieser Eintrag ist bereits vergeben');
  end if;
  -- Alte abgelehnte Anfragen entfernen, damit der partielle Unique-Index nicht blockt
  delete from legacy_credit_requests where requesting_user_id = v_uid and status = 'rejected';
  insert into legacy_credit_requests(legacy_credit_id, requesting_user_id, status)
    values (p_credit_id, v_uid, 'pending')
    on conflict do nothing;
  return json_build_object('status','submitted');
end;
$$;

-- Admin genehmigt eine Zuordnungs-Anfrage
create or replace function public.approve_legacy_credit_request(p_request_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_req legacy_credit_requests%rowtype;
begin
  if not exists (select 1 from profiles where id = v_uid and is_admin = true) then
    return json_build_object('error','Keine Berechtigung');
  end if;
  select * into v_req from legacy_credit_requests where id = p_request_id and status = 'pending';
  if not found then return json_build_object('error','Anfrage nicht gefunden'); end if;

  update legacy_credits
    set matched_user_id = v_req.requesting_user_id, match_confirmed = true
    where id = v_req.legacy_credit_id and matched_user_id is null;
  update legacy_credit_requests set status = 'approved' where id = p_request_id;
  -- Konkurrierende Anfragen für dasselbe Guthaben ablehnen
  update legacy_credit_requests
    set status = 'rejected', admin_note = 'Bereits jemand anderem zugeordnet'
    where legacy_credit_id = v_req.legacy_credit_id and id != p_request_id and status = 'pending';

  return json_build_object('status','approved');
end;
$$;

-- Admin lehnt eine Zuordnungs-Anfrage ab
create or replace function public.reject_legacy_credit_request(p_request_id uuid, p_note text default null)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (select 1 from profiles where id = v_uid and is_admin = true) then
    return json_build_object('error','Keine Berechtigung');
  end if;
  update legacy_credit_requests set status = 'rejected', admin_note = p_note where id = p_request_id and status = 'pending';
  return json_build_object('status','rejected');
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- Trigger
-- ──────────────────────────────────────────────────────────────────────────────

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ──────────────────────────────────────────────────────────────────────────────
-- Grants (ohne diese bekommen alle Anfragen 403 trotz RLS-Policies)
-- ──────────────────────────────────────────────────────────────────────────────

grant select, insert, update, delete on public.profiles               to authenticated;
grant select, insert, update, delete on public.festival_config        to authenticated;
grant select, insert, update, delete on public.cost_items             to authenticated;
grant select, insert, update, delete on public.participant_payments   to authenticated;
grant select, insert, update, delete on public.attendance             to authenticated;
grant select                         on public.legacy_credits         to authenticated; -- Schreibzugriff nur via SECURITY DEFINER-Funktionen
grant select, insert, update, delete on public.legacy_credit_requests to authenticated;
grant select, insert, update, delete on public.legacy_credit_decisions to authenticated;

grant execute on function public.is_admin()                              to authenticated;
grant execute on function public.try_automatch_legacy_credit()           to authenticated;
grant execute on function public.submit_legacy_credit_request(uuid)      to authenticated;
grant execute on function public.approve_legacy_credit_request(uuid)     to authenticated;
grant execute on function public.reject_legacy_credit_request(uuid,text) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS-Policies
-- ──────────────────────────────────────────────────────────────────────────────

-- Profiles
create policy "profiles_select_own"   on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_insert_own"   on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_select_admin" on public.profiles for select to authenticated using (public.is_admin());
create policy "profiles_update_admin" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Festival Config
create policy "config_select_auth"  on public.festival_config for select to authenticated using (true);
create policy "config_insert_admin" on public.festival_config for insert to authenticated with check (public.is_admin());
create policy "config_update_admin" on public.festival_config for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Cost Items
create policy "costs_select_auth"  on public.cost_items for select to authenticated using (true);
create policy "costs_insert_admin" on public.cost_items for insert to authenticated with check (public.is_admin());
create policy "costs_update_admin" on public.cost_items for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "costs_delete_admin" on public.cost_items for delete to authenticated using (public.is_admin());

-- Participant Payments
create policy "payments_select_own"   on public.participant_payments for select to authenticated using ((select auth.uid()) = user_id);
create policy "payments_select_admin" on public.participant_payments for select to authenticated using (public.is_admin());
create policy "payments_insert_admin" on public.participant_payments for insert to authenticated with check (public.is_admin());
create policy "payments_update_admin" on public.participant_payments for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "payments_delete_admin" on public.participant_payments for delete to authenticated using (public.is_admin());

-- Attendance (User verwaltet eigene Anwesenheit, Admin alles)
create policy "attendance_select_own"   on public.attendance for select to authenticated using ((select auth.uid()) = user_id);
create policy "attendance_select_admin" on public.attendance for select to authenticated using (public.is_admin());
create policy "attendance_write_own"    on public.attendance for all    to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "attendance_write_admin"  on public.attendance for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- Legacy Credits (nur lesen: eigene, unzugeordnete oder als Admin alle)
create policy "Users see relevant credits" on public.legacy_credits for select using (
  matched_user_id is null
  or matched_user_id = auth.uid()
  or exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true)
);

-- Legacy Credit Requests
create policy "Users manage own requests" on public.legacy_credit_requests for all using (requesting_user_id = auth.uid());
create policy "Admins see all requests"   on public.legacy_credit_requests for select using (
  exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true)
);
create policy "Admins update requests"    on public.legacy_credit_requests for update using (
  exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true)
);

-- Legacy Credit Decisions
create policy "Users manage own decisions" on public.legacy_credit_decisions for all using (user_id = auth.uid());
create policy "Admins see all decisions"   on public.legacy_credit_decisions for select using (
  exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin = true)
);

-- ──────────────────────────────────────────────────────────────────────────────
-- Nach erstem Login: Admin setzen
-- update public.profiles set is_admin = true where email = 'deine@email.de';
