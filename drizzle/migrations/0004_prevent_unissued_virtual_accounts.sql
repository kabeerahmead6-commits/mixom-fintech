alter table public.profiles add column virtual_account_issued boolean not null default false;

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
  return new;
end $$;
comment on column public.profiles.virtual_account_number is 'A real provider-issued account number only; demo sequence values are not bank accounts.';
comment on column public.profiles.virtual_account_issued is 'True only after the real bank/provider confirms virtual-account issuance.';