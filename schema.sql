-- =====================================================================
-- Petites Fiches — Supabase schema
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: it uses "if not exists" / "create or replace" where it can.
-- =====================================================================

-- ---------- 1. Profiles (one per user, public for the leaderboard) ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 30),
  avatar        text not null default '🙂' check (char_length(avatar) <= 16),
  xp            integer not null default 0,
  week_key      date,
  week_xp       integer not null default 0,
  learned       integer not null default 0,
  mastered      integer not null default 0,
  streak        integer not null default 0,
  games_played  integer not null default 0,
  games_won     integer not null default 0,
  last_active   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Profiles are readable by signed-in users" on public.profiles;
create policy "Profiles are readable by signed-in users"
  on public.profiles for select to authenticated using (true);

drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

create index if not exists profiles_xp_idx      on public.profiles (xp desc);
create index if not exists profiles_week_xp_idx on public.profiles (week_key, week_xp desc);

-- Create a profile automatically when someone signs up (email or Google).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  nm text := coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    split_part(new.email, '@', 1),
    'Learner');
  emojis text[] := array['🦊','🐼','🐸','🦉','🐯','🐨','🐙','🦄','🐝','🐧','🦁','🐢'];
begin
  insert into public.profiles (id, display_name, avatar)
  values (new.id, left(nm, 30), emojis[1 + floor(random() * array_length(emojis, 1))::int])
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 2. Study progress (private to each user) ----------
create table if not exists public.progress (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.progress enable row level security;

drop policy if exists "Users read their own progress" on public.progress;
create policy "Users read their own progress"
  on public.progress for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users insert their own progress" on public.progress;
create policy "Users insert their own progress"
  on public.progress for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users update their own progress" on public.progress;
create policy "Users update their own progress"
  on public.progress for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 3. Live games ----------
create table if not exists public.games (
  code        text primary key check (code ~ '^[A-Z0-9]{4}$'),
  host        uuid not null references auth.users(id) on delete cascade,
  cat         text not null,
  qs          jsonb not null,
  dur         integer not null check (dur between 5000 and 60000),
  phase       text not null default 'lobby' check (phase in ('lobby','question','reveal','end')),
  q           integer not null default -1,
  scores      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

alter table public.games enable row level security;

drop policy if exists "Signed-in users can see games" on public.games;
create policy "Signed-in users can see games"
  on public.games for select to authenticated using (true);

drop policy if exists "Users create games they host" on public.games;
create policy "Users create games they host"
  on public.games for insert to authenticated with check (auth.uid() = host);

drop policy if exists "Only the host runs the game" on public.games;
create policy "Only the host runs the game"
  on public.games for update to authenticated
  using (auth.uid() = host) with check (auth.uid() = host);

drop policy if exists "Host can delete the game" on public.games;
create policy "Host can delete the game"
  on public.games for delete to authenticated using (auth.uid() = host);

create table if not exists public.game_players (
  game_code  text not null references public.games(code) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  answers    jsonb not null default '{}'::jsonb,
  joined_at  timestamptz not null default now(),
  primary key (game_code, user_id)
);

alter table public.game_players enable row level security;

drop policy if exists "Signed-in users can see players" on public.game_players;
create policy "Signed-in users can see players"
  on public.game_players for select to authenticated using (true);

drop policy if exists "Users join games themselves" on public.game_players;
create policy "Users join games themselves"
  on public.game_players for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.games g where g.code = game_code and g.phase = 'lobby')
  );

drop policy if exists "Users update their own answers" on public.game_players;
create policy "Users update their own answers"
  on public.game_players for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Live updates for games (Supabase Realtime)
do $$ begin
  begin alter publication supabase_realtime add table public.games;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.game_players; exception when duplicate_object then null; end;
end $$;

-- Remove games older than 2 days (called by the app when someone hosts a game).
create or replace function public.cleanup_old_games()
returns void language sql security definer set search_path = public as $$
  delete from public.games where created_at < now() - interval '2 days';
$$;
grant execute on function public.cleanup_old_games() to authenticated;

-- ---------- 4. Let users delete their own account ----------
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
