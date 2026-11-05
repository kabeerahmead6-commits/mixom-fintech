revoke update on public.profiles from authenticated;
grant update (full_name, phone, card_frozen) on public.profiles to authenticated;

alter table public.mpins add column failed_attempts integer not null default 0;
alter table public.mpins add column locked_until timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
begin
  t := coalesce(new.raw_user_meta_data->>'account_type', 'customer');
  if t not in ('customer','agent') then t := 'customer'; end if;
  insert into public.profiles (id, email, full_name, phone, account_type, shop_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''), nullif(new.raw_user_meta_data->>'phone',''), t, nullif(new.raw_user_meta_data->>'shop_name',''));
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  insert into public.wallets (user_id, balance) values (new.id, 0);
  if t = 'customer' then
    update public.profiles set virtual_account_number = nextval('public.neo_vacc_seq')::text where id = new.id;
  end if;
  return new;
end $$;

create or replace function public.grant_bootstrap_admin_on_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is not null and lower(new.email) = 'kabeerahmead6@gmail.com' then
    insert into public.user_roles (user_id, role)
    values (new.id, 'admin')
    on conflict (user_id, role) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.grant_bootstrap_admin_on_confirmation() from public, anon, authenticated;
create trigger on_auth_user_confirmed_admin
after update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function public.grant_bootstrap_admin_on_confirmation();