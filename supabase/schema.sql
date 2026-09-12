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

create table public.cost_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Kategorienamen sind case-insensitive eindeutig
create unique index cost_categories_name_unique
  on public.cost_categories (lower(trim(name)));

create table public.cost_items (
  id uuid primary key default gen_random_uuid(),
  -- Bezeichnung der Position (z. B. "Sojaschnetzel"); die Kategorie hängt an category_id
  name text not null,
  amount numeric(10,2) not null default 0,
  description text,
  created_at timestamptz not null default now(),
  category_id uuid references public.cost_categories(id) on delete set null,
  -- wer die Position ausgelegt hat; null = noch offen
  paid_by uuid references public.profiles(id) on delete set null
);

create index cost_items_category_id_idx on public.cost_items (category_id);
create index cost_items_paid_by_idx     on public.cost_items (paid_by);

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
  -- nullable: Admins pflegen auch Entscheidungen für WWW6-Leute ohne Account
  user_id uuid references public.profiles(id) on delete cascade,
  set_by_admin_id uuid references public.profiles(id) on delete set null,
  decision text not null check (decision in ('refund', 'apply_www7', 'donate_www', 'donate_org1', 'donate_org2')),
  decided_at timestamptz not null default now(),
  -- Erledigt-Sperre: gesetzt = ausgezahlt/abgeführt, Entscheidung ist eingefroren
  settled_at timestamptz,
  settled_by uuid references public.profiles(id) on delete set null,
  unique(legacy_credit_id)
);

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS aktivieren
-- ──────────────────────────────────────────────────────────────────────────────

alter table public.profiles               enable row level security;
alter table public.festival_config        enable row level security;
alter table public.cost_categories        enable row level security;
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
    update legacy_credit_decisions set user_id = v_uid
      where legacy_credit_id = v_credit.id and user_id is null;
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
    -- Hat der Admin die Entscheidung schon händisch gepflegt, zieht sie mit um.
    -- Sonst fände das Portal sie wegen RLS (user_id = auth.uid()) nicht.
    update legacy_credit_decisions set user_id = v_uid
      where legacy_credit_id = v_credit.id and user_id is null;
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
  -- Bereits händisch gepflegte Entscheidung dem Account zuschreiben (siehe try_automatch)
  update legacy_credit_decisions set user_id = v_req.requesting_user_id
    where legacy_credit_id = v_req.legacy_credit_id and user_id is null;
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

-- Gemeinsame Recompute-Logik für amount_due (nur unbezahlte Zeilen). Formel identisch
-- zum Admin-Dashboard: max(0, Tage_present(day_index<num_days) × daily_rate − Abzug),
-- Abzug nur bei Entscheidung apply_www7. Von den Wrappern unten geteilt, damit
-- Entscheidungs- und Anwesenheits-Pfad nicht auseinanderdriften. Bleibt intern.
create or replace function public._recompute_payment_due(p_uid uuid)
returns numeric language plpgsql security definer set search_path to 'public' as $$
declare
  v_days     integer;
  v_rate     numeric(10,2);
  v_ndays    integer;
  v_discount numeric(10,2);
  v_due      numeric(10,2);
begin
  select num_days, daily_rate into v_ndays, v_rate from festival_config where id = 1;
  select count(*) into v_days from attendance
    where user_id = p_uid and present and day_index < v_ndays;
  select lc.amount_owed into v_discount
    from legacy_credit_decisions d
    join legacy_credits lc on lc.id = d.legacy_credit_id
    where d.user_id = p_uid and d.decision = 'apply_www7'
    limit 1;
  v_discount := coalesce(v_discount, 0);
  v_due := greatest(0, v_days * v_rate - v_discount);

  update participant_payments
    set amount_due = v_due
    where user_id = p_uid and paid = false;

  return v_due;
end;
$$;

revoke execute on function public._recompute_payment_due(uuid) from public;

-- User setzt seine Altguthaben-Entscheidung UND rechnet einen bereits festgeschriebenen
-- (noch unbezahlten) Betrag neu. Ohne die Neuberechnung blieb amount_due ein veralteter
-- Schnappschuss, wenn nach dem Festlegen von verrechnen (apply_www7) auf spenden
-- gewechselt wurde.
create or replace function public.set_legacy_decision(p_decision text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid    uuid := auth.uid();
  v_credit legacy_credits%rowtype;
  v_due    numeric(10,2);
begin
  if v_uid is null then
    return json_build_object('error','Nicht angemeldet');
  end if;

  if p_decision not in ('refund','apply_www7','donate_www','donate_org1','donate_org2') then
    return json_build_object('error','Ungültige Entscheidung');
  end if;

  select * into v_credit from legacy_credits where matched_user_id = v_uid limit 1;
  if not found then
    return json_build_object('error','Kein zugeordnetes Guthaben');
  end if;

  if exists (select 1 from legacy_credit_decisions
             where legacy_credit_id = v_credit.id and settled_at is not null) then
    return json_build_object('error','Dein Altguthaben ist bereits abgeschlossen und kann nicht mehr geändert werden.');
  end if;

  insert into legacy_credit_decisions (legacy_credit_id, user_id, decision, decided_at)
    values (v_credit.id, v_uid, p_decision, now())
    on conflict (legacy_credit_id)
    do update set decision = excluded.decision, decided_at = excluded.decided_at, user_id = excluded.user_id;

  -- Betrag neu berechnen (liest die gerade geschriebene Entscheidung)
  v_due := public._recompute_payment_due(v_uid);

  return json_build_object('status','ok', 'amount_due', v_due);
end;
$$;

-- Recompute für den aufrufenden User, ausgelöst z. B. nach "Anwesenheit bestätigen",
-- damit geänderte Tage sofort im festgelegten (unbezahlten) Betrag greifen.
create or replace function public.recompute_my_payment()
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_due numeric(10,2);
begin
  if v_uid is null then
    return json_build_object('error','Nicht angemeldet');
  end if;
  v_due := public._recompute_payment_due(v_uid);
  return json_build_object('status','ok','amount_due', v_due);
end;
$$;

-- Admin setzt die Altguthaben-Entscheidung für einen beliebigen Eintrag händisch.
-- Verhält sich wie set_legacy_decision auf Nutzerseite (upsert auf legacy_credit_id
-- plus Neuberechnung des unbezahlten Betrags), funktioniert aber auch für WWW6-Leute
-- ohne Account. apply_www7 setzt einen zugeordneten Account voraus.
create or replace function public.admin_set_legacy_decision(p_credit_id uuid, p_decision text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid    uuid := auth.uid();
  v_credit legacy_credits%rowtype;
  v_due    numeric(10,2);
begin
  if not public.is_admin() then
    return json_build_object('error','Keine Berechtigung');
  end if;

  if p_decision not in ('refund','apply_www7','donate_www','donate_org1','donate_org2') then
    return json_build_object('error','Ungültige Entscheidung');
  end if;

  select * into v_credit from legacy_credits where id = p_credit_id;
  if not found then
    return json_build_object('error','Guthaben nicht gefunden');
  end if;

  if exists (select 1 from legacy_credit_decisions
             where legacy_credit_id = p_credit_id and settled_at is not null) then
    return json_build_object('error','Als erledigt markiert — erst die Sperre lösen');
  end if;

  if p_decision = 'apply_www7' and v_credit.matched_user_id is null then
    return json_build_object('error','Verrechnung braucht einen zugeordneten Account');
  end if;

  insert into legacy_credit_decisions (legacy_credit_id, user_id, decision, decided_at, set_by_admin_id)
    values (v_credit.id, v_credit.matched_user_id, p_decision, now(), v_uid)
    on conflict (legacy_credit_id)
    do update set decision        = excluded.decision,
                  decided_at      = excluded.decided_at,
                  user_id         = excluded.user_id,
                  set_by_admin_id = excluded.set_by_admin_id;

  if v_credit.matched_user_id is not null then
    v_due := public._recompute_payment_due(v_credit.matched_user_id);
  end if;

  return json_build_object('status','ok','amount_due', v_due);
end;
$$;

-- Admin nimmt eine Entscheidung zurück (Fehleingabe / Person meldet sich doch an).
create or replace function public.admin_clear_legacy_decision(p_credit_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_credit legacy_credits%rowtype;
  v_due    numeric(10,2);
begin
  if not public.is_admin() then
    return json_build_object('error','Keine Berechtigung');
  end if;

  select * into v_credit from legacy_credits where id = p_credit_id;
  if not found then
    return json_build_object('error','Guthaben nicht gefunden');
  end if;

  if exists (select 1 from legacy_credit_decisions
             where legacy_credit_id = p_credit_id and settled_at is not null) then
    return json_build_object('error','Als erledigt markiert — erst die Sperre lösen');
  end if;

  delete from legacy_credit_decisions where legacy_credit_id = p_credit_id;

  if v_credit.matched_user_id is not null then
    v_due := public._recompute_payment_due(v_credit.matched_user_id);
  end if;

  return json_build_object('status','ok','amount_due', v_due);
end;
$$;

-- Admin setzt/entfernt die Erledigt-Markierung (Rückzahlung überwiesen, Spende abgeführt).
-- Idempotent: erneutes Setzen auf denselben Zustand ist ein No-Op statt ein Trigger-Fehler.
create or replace function public.admin_set_legacy_settled(p_credit_id uuid, p_settled boolean)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid        uuid := auth.uid();
  v_settled_at timestamptz;
  v_found      boolean;
begin
  if not public.is_admin() then
    return json_build_object('error','Keine Berechtigung');
  end if;

  select settled_at, true into v_settled_at, v_found
    from legacy_credit_decisions where legacy_credit_id = p_credit_id;

  if not coalesce(v_found, false) then
    return json_build_object('error','Ohne Entscheidung gibt es nichts abzuschließen');
  end if;

  if (v_settled_at is not null) = p_settled then
    return json_build_object('status','ok','settled', p_settled);
  end if;

  update legacy_credit_decisions
    set settled_at = case when p_settled then now() else null end,
        settled_by = case when p_settled then v_uid else null end
    where legacy_credit_id = p_credit_id;

  return json_build_object('status','ok','settled', p_settled);
end;
$$;

-- Die Erledigt-Sperre wird per Trigger durchgesetzt, nicht nur in den RPCs: authenticated
-- hat direkte Schreibrechte auf die Tabelle, ein deaktiviertes Dropdown wäre keine Sperre.
create or replace function public.guard_settled_legacy_decision()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if TG_OP = 'INSERT' then
    -- Erledigt-Markierung darf nur ein Admin direkt mitschreiben
    if NEW.settled_at is not null and not public.is_admin() then
      raise exception 'Nur Admins können ein Altguthaben als erledigt markieren.'
        using errcode = 'check_violation';
    end if;
    return NEW;
  end if;

  -- Nicht gesperrt: alles wie gehabt
  if OLD.settled_at is null then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;

  if TG_OP = 'DELETE' then
    raise exception 'Altguthaben ist als erledigt markiert und gesperrt.'
      using errcode = 'check_violation';
  end if;

  -- Nachträgliche Zuordnung eines Accounts ist reine Zuschreibung und bleibt erlaubt:
  -- meldet sich jemand nach der Auszahlung doch noch an, soll die Entscheidung ihm
  -- zugeordnet werden. RLS lässt das nur über die SECURITY-DEFINER-Pfade zu.
  if OLD.user_id is null and NEW.user_id is not null
     and NEW.settled_at       is not distinct from OLD.settled_at
     and NEW.decision         is not distinct from OLD.decision
     and NEW.legacy_credit_id is not distinct from OLD.legacy_credit_id then
    return NEW;
  end if;

  -- Sonst ist die einzige erlaubte Änderung: ein Admin hebt die Sperre wieder auf.
  if not public.is_admin() then
    raise exception 'Altguthaben ist als erledigt markiert und gesperrt.'
      using errcode = 'check_violation';
  end if;

  if NEW.settled_at is not null
     or NEW.decision         is distinct from OLD.decision
     or NEW.legacy_credit_id is distinct from OLD.legacy_credit_id
     or NEW.user_id          is distinct from OLD.user_id then
    raise exception 'Erledigtes Altguthaben ist gesperrt — erst die Erledigt-Markierung entfernen.'
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

drop trigger if exists guard_settled_legacy_decision on public.legacy_credit_decisions;
create trigger guard_settled_legacy_decision
  before insert or update or delete on public.legacy_credit_decisions
  for each row execute function public.guard_settled_legacy_decision();

-- Mail-Helfer für die notify-Edge-Function (umgeht die Service-Role).
-- Liefert die Mail-Adressen aller Admins (für "neue Anfrage"-Benachrichtigung).
create or replace function public.notify_admin_emails()
returns setof text
language sql security definer set search_path = public stable as $$
  select email from public.profiles where is_admin = true
$$;

-- Liefert email/first_name/name eines Nutzers – aber NUR wenn der Aufrufer Admin ist.
create or replace function public.notify_get_recipient(p_user_id uuid)
returns json
language plpgsql security definer set search_path = public stable as $$
declare r json;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    return null;
  end if;
  select json_build_object('email', email, 'first_name', first_name, 'name', name)
    into r from public.profiles where id = p_user_id;
  return r;
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
grant select, insert, update, delete on public.cost_categories        to authenticated;
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
grant execute on function public.set_legacy_decision(text)               to authenticated;
grant execute on function public.recompute_my_payment()                  to authenticated;
grant execute on function public.admin_set_legacy_decision(uuid,text)   to authenticated;
grant execute on function public.admin_clear_legacy_decision(uuid)      to authenticated;
grant execute on function public.admin_set_legacy_settled(uuid,boolean)  to authenticated;
grant execute on function public.notify_admin_emails()                   to authenticated;
grant execute on function public.notify_get_recipient(uuid)              to authenticated;

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
create policy "cost_categories_select_auth"  on public.cost_categories for select to authenticated using (true);
create policy "cost_categories_insert_admin" on public.cost_categories for insert to authenticated with check (public.is_admin());
create policy "cost_categories_update_admin" on public.cost_categories for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "cost_categories_delete_admin" on public.cost_categories for delete to authenticated using (public.is_admin());

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
