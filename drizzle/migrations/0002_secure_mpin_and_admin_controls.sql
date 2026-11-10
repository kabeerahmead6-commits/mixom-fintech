revoke all on function public.has_role(uuid, public.app_role) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;

create or replace function public.record_mpin_failure(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
begin
  update public.mpins
  set failed_attempts = case when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end,
      locked_until = case
        when (case when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end) >= 5
        then now() + interval '15 minutes'
        else null
      end
  where user_id = p_user_id
  returning failed_attempts into v_attempts;
  return coalesce(v_attempts, 5);
end $$;
revoke all on function public.record_mpin_failure(uuid) from public, anon, authenticated;
grant execute on function public.record_mpin_failure(uuid) to service_role;

create or replace function public.set_mpin_once(p_user_id uuid, p_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.mpins (user_id, hash, failed_attempts, locked_until)
  values (p_user_id, p_hash, 0, null)
  on conflict (user_id) do nothing;
  return found;
end $$;
revoke all on function public.set_mpin_once(uuid, text) from public, anon, authenticated;
grant execute on function public.set_mpin_once(uuid, text) to service_role;

create or replace function public.admin_update_profile(p_user_id uuid, p_kyc_status text default null, p_blocked boolean default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_type text;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Forbidden';
  end if;
  if p_kyc_status is null and p_blocked is null then
    raise exception 'No profile change provided';
  end if;
  if p_kyc_status is not null and p_kyc_status not in ('pending','verified','rejected') then
    raise exception 'Invalid KYC status';
  end if;
  select account_type into v_account_type from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Account not found'; end if;
  update public.profiles
  set kyc_status = coalesce(p_kyc_status, kyc_status),
      blocked = coalesce(p_blocked, blocked)
  where id = p_user_id;
  if v_account_type = 'agent' and p_kyc_status is not null then
    if p_kyc_status = 'verified' then
      insert into public.user_roles (user_id, role) values (p_user_id, 'agent') on conflict (user_id, role) do nothing;
    else
      delete from public.user_roles where user_id = p_user_id and role = 'agent';
    end if;
  end if;
  return true;
end $$;
revoke all on function public.admin_update_profile(uuid, text, boolean) from public, anon;
grant execute on function public.admin_update_profile(uuid, text, boolean) to authenticated;
grant execute on function public.admin_update_profile(uuid, text, boolean) to service_role;