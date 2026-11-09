-- Make the access model 0001_init.sql describes actually hold: clients (the browser's publishable/anon
-- key and a signed-in user's JWT) get NO direct table or function access; only the server's
-- service-role key does.
--
-- Supabase's default privileges grant anon/authenticated access to every new table and function in
-- `public`, and Postgres grants EXECUTE to PUBLIC by default, so 0001's grants to service_role alone
-- don't keep clients out. RLS blocks the tables, but the SECURITY DEFINER functions bypass RLS: with only
-- the public key, anyone could call get_workspace_members(<workspace id>) and read member emails.
--
-- Idempotent; safe to run on an existing project. service_role keeps its grants from 0001.
revoke all on public.workspaces, public.memberships, public.invitations, public.agents
  from anon, authenticated;

revoke execute on function
  public.get_workspace_members(uuid),
  public.get_invitation(uuid),
  public.accept_invitation(uuid, uuid),
  public.is_workspace_member(uuid),
  public.is_workspace_admin(uuid),
  public.handle_new_workspace()
  from public, anon, authenticated;

grant execute on function public.get_workspace_members(uuid)   to service_role;
grant execute on function public.get_invitation(uuid)          to service_role;
grant execute on function public.accept_invitation(uuid, uuid) to service_role;
