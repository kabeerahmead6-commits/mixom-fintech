create or replace function public.set_mpin_once(p_user_id uuid, p_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = p_user_id and blocked = false) then
    raise exception 'Account unavailable';
  end if;
  insert into public.mpins (user_id, hash, failed_attempts, locked_until)
  values (p_user_id, p_hash, 0, null)
  on conflict (user_id) do nothing;
  return found;
end $$;
revoke all on function public.set_mpin_once(uuid, text) from public, anon, authenticated;
grant execute on function public.set_mpin_once(uuid, text) to service_role;