-- Neon backend schema. Same tables as supabase/migrations/0001_init.sql, minus everything that only
-- exists because Supabase hands the browser a database key (RLS policies, anon/authenticated grants).
-- On Neon the browser never reaches Postgres: Managed Better Auth (Neon Auth) handles sign-in, and every
-- read and write goes through this app's Next.js server over DATABASE_URL, gated by src/lib/auth.ts.
--
-- Users live in neon_auth."user", the table Managed Better Auth manages in this same database (it
-- must be enabled before this runs — setup provisions it). The user foreign keys mirror the Supabase
-- schema's references to auth.users. Idempotent: `npm run setup:neon` re-runs it safely.

create table if not exists public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_id   uuid not null references neon_auth."user" (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references neon_auth."user" (id) on delete cascade,
  role         text not null check (role = 'admin'),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.invitations (
  token        uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  role         text not null check (role = 'admin'),
  created_by   uuid references neon_auth."user" (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days'
);

create table if not exists public.agents (
  agent37_id   text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text,
  status       text,
  template     text,
  cpu          integer,
  memory       integer,
  disk         integer,
  created_by   uuid references neon_auth."user" (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists agents_workspace_idx on public.agents (workspace_id);
create index if not exists memberships_user_idx on public.memberships (user_id);

-- Consume an invitation in one transaction: validate it, upsert the membership, delete the token.
-- p_user is the verified session user id the server passes in.
create or replace function public.accept_invitation(p_token uuid, p_user uuid)
returns uuid
language plpgsql
as $$
declare
  v_inv public.invitations%rowtype;
begin
  select * into v_inv from public.invitations where token = p_token for update;
  if not found then
    raise exception 'invitation not found';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'invitation expired';
  end if;
  insert into public.memberships (workspace_id, user_id, role)
  values (v_inv.workspace_id, p_user, v_inv.role)
  on conflict (workspace_id, user_id) do update set role = excluded.role;
  delete from public.invitations where token = p_token;
  return v_inv.workspace_id;
end;
$$;
