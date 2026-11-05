create type public.app_role as enum ('admin','agent','user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  account_type text not null default 'customer' check (account_type in ('customer','agent')),
  shop_name text,
  kyc_status text not null default 'pending' check (kyc_status in ('pending','verified','rejected')),
  blocked boolean not null default false,
  virtual_account_number text unique,
  virtual_ifsc text not null default 'NEOB0000001',
  card_frozen boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.mpins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hash text not null,
  updated_at timestamptz not null default now()
);
grant all on public.mpins to service_role;
alter table public.mpins enable row level security;

create table public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance numeric(14,2) not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
grant select on public.wallets to authenticated;
grant all on public.wallets to service_role;
alter table public.wallets enable row level security;

create table public.beneficiaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  account_number text not null,
  ifsc text not null,
  bank_name text not null default '',
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.beneficiaries to authenticated;
grant all on public.beneficiaries to service_role;
alter table public.beneficiaries enable row level security;

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  direction text not null check (direction in ('credit','debit')),
  category text not null,
  amount numeric(14,2) not null check (amount > 0),
  fee numeric(14,2) not null default 0,
  commission numeric(14,2) not null default 0,
  status text not null default 'success' check (status in ('success','pending','failed')),
  reference text not null default '',
  description text not null default '',
  counterparty jsonb,
  meta jsonb,
  balance_after numeric(14,2),
  created_at timestamptz not null default now()
);
grant select on public.transactions to authenticated;
grant all on public.transactions to service_role;
alter table public.transactions enable row level security;

create table public.commission_rates (
  service text primary key,
  percent numeric(5,2) not null default 0,
  updated_at timestamptz not null default now()
);
grant select, update on public.commission_rates to authenticated;
grant all on public.commission_rates to service_role;
alter table public.commission_rates enable row level security;

create index transactions_user_created_idx on public.transactions(user_id, created_at desc);
create sequence public.neo_vacc_seq start 501000000001;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;

create policy "Users read own roles" on public.user_roles for select to authenticated using (auth.uid() = user_id);
create policy "Admins read all roles" on public.user_roles for select to authenticated using (public.has_role(auth.uid(),'admin'::public.app_role));
create policy "Users read own profile" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "Admins read all profiles" on public.profiles for select to authenticated using (public.has_role(auth.uid(),'admin'::public.app_role));
create policy "Users update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "Admins update all profiles" on public.profiles for update to authenticated using (public.has_role(auth.uid(),'admin'::public.app_role)) with check (public.has_role(auth.uid(),'admin'::public.app_role));
create policy "Users read own wallet" on public.wallets for select to authenticated using (auth.uid() = user_id);
create policy "Admins read all wallets" on public.wallets for select to authenticated using (public.has_role(auth.uid(),'admin'::public.app_role));
create policy "Users manage own beneficiaries" on public.beneficiaries for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users read own transactions" on public.transactions for select to authenticated using (auth.uid() = user_id);
create policy "Admins read all transactions" on public.transactions for select to authenticated using (public.has_role(auth.uid(),'admin'::public.app_role));
create policy "Users read commission rates" on public.commission_rates for select to authenticated using (true);
create policy "Admins update commission rates" on public.commission_rates for update to authenticated using (public.has_role(auth.uid(),'admin'::public.app_role)) with check (public.has_role(auth.uid(),'admin'::public.app_role));

create or replace function public.apply_wallet_txn(
  p_user_id uuid,
  p_direction text,
  p_category text,
  p_amount numeric,
  p_description text default '',
  p_status text default 'success',
  p_fee numeric default 0,
  p_commission numeric default 0,
  p_counterparty jsonb default null,
  p_meta jsonb default null
)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(14,2);
  v_txn public.transactions;
  v_ref text;
begin
  if p_amount <= 0 or p_direction not in ('credit','debit') or p_fee < 0 then
    raise exception 'Invalid transaction amount';
  end if;
  select balance into v_balance from public.wallets where user_id = p_user_id for update;
  if not found then
    insert into public.wallets (user_id, balance) values (p_user_id, 0) on conflict (user_id) do nothing;
    select balance into v_balance from public.wallets where user_id = p_user_id for update;
  end if;
  if p_direction = 'debit' and v_balance < p_amount + p_fee then
    raise exception 'Insufficient wallet balance';
  end if;
  if p_direction = 'credit' then
    v_balance := v_balance + p_amount;
  else
    v_balance := v_balance - p_amount - p_fee;
  end if;
  update public.wallets set balance = v_balance, updated_at = now() where user_id = p_user_id;
  v_ref := 'NEO' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10));
  insert into public.transactions (user_id, direction, category, amount, fee, status, reference, description, counterparty, meta, balance_after)
  values (p_user_id, p_direction, p_category, p_amount, p_fee, p_status, v_ref, p_description, p_counterparty, p_meta, v_balance)
  returning * into v_txn;
  if p_commission > 0 and p_status = 'success' then
    v_balance := v_balance + p_commission;
    update public.wallets set balance = v_balance, updated_at = now() where user_id = p_user_id;
    insert into public.transactions (user_id, direction, category, amount, status, description, meta, balance_after)
    values (p_user_id, 'credit', 'commission', p_commission, 'success', 'Commission earned', jsonb_build_object('service', p_category), v_balance);
  end if;
  return v_txn;
end $$;
revoke all on function public.apply_wallet_txn(uuid, text, text, numeric, text, text, numeric, numeric, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_wallet_txn(uuid, text, text, numeric, text, text, numeric, numeric, jsonb, jsonb) to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  new_role public.app_role;
begin
  t := coalesce(new.raw_user_meta_data->>'account_type', 'customer');
  if t not in ('customer','agent') then t := 'customer'; end if;
  new_role := case when lower(coalesce(new.email,'')) = 'kabeerahmead6@gmail.com' then 'admin'::public.app_role else 'user'::public.app_role end;
  insert into public.profiles (id, email, full_name, phone, account_type, shop_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''), nullif(new.raw_user_meta_data->>'phone',''), t, nullif(new.raw_user_meta_data->>'shop_name',''));
  insert into public.user_roles (user_id, role) values (new.id, new_role);
  insert into public.wallets (user_id, balance) values (new.id, 0);
  if t = 'customer' then
    update public.profiles set virtual_account_number = nextval('public.neo_vacc_seq')::text where id = new.id;
  end if;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();