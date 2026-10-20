-- SupplyLink baseline. Apply in a fresh Supabase project.
-- No broad client mutation policies: stock/payment/fulfilment transactions are next-phase work.
begin;
create type public.portal_role as enum ('hq', 'sme', 'branch', 'driver');
create type public.account_status as enum ('active', 'suspended');
create type public.order_status as enum ('Draft', 'Awaiting verification', 'Confirmed', 'Preparing', 'Shipping', 'On hold', 'Complete', 'Done', 'Cancelled');

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 100),
  address text not null,
  manager_name text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users(id),
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
  name text not null,
  role public.portal_role not null,
  status public.account_status not null default 'active',
  branch_id uuid references public.branches(id),
  phone text not null default '',
  address text not null default '',
  must_change_password boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (role <> 'branch' or branch_id is not null),
  check (role in ('branch','driver') or branch_id is null)
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  category text not null,
  pack text not null,
  base_units_per_pack integer not null check (base_units_per_pack > 0),
  wholesale_price numeric(16,0) not null check (wholesale_price >= 0),
  minimum_packs integer not null default 1 check (minimum_packs > 0),
  available_packs integer not null default 0 check (available_packs >= 0),
  tone text not null default 'rice',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id), -- null is HQ
  product_id uuid not null references public.products(id),
  on_hand integer not null default 0 check (on_hand >= 0),
  protected_reserve integer not null default 0 check (protected_reserve >= 0),
  allocated integer not null default 0 check (allocated >= 0),
  unique nulls not distinct (branch_id, product_id),
  check (protected_reserve + allocated <= on_hand)
);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  sme_id uuid not null references public.profiles(id),
  business_name text not null,
  destination text not null,
  receiver_name text not null,
  receiver_phone text not null,
  item_count integer not null check (item_count > 0),
  merchandise_total numeric(16,0) not null check (merchandise_total >= 0),
  shipping_total numeric(16,0) not null check (shipping_total >= 0),
  status public.order_status not null default 'Draft',
  source_name text not null default 'Yangon HQ',
  source_branch_id uuid references public.branches(id),
  payment_verified_at timestamptz,
  reserved_at timestamptz,
  hq_completed_at timestamptz,
  sme_received_at timestamptz,
  done_at timestamptz,
  has_open_issue boolean not null default false,
  created_at timestamptz not null default now(),
  check (status not in ('Confirmed','Preparing','Shipping','Complete','Done') or (payment_verified_at is not null and reserved_at is not null)),
  check (status <> 'Done' or (hq_completed_at is not null and sme_received_at is not null and done_at is not null and not has_open_issue))
);
create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  product_id uuid not null references public.products(id),
  product_name text not null,
  pack_snapshot text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(16,0) not null check (unit_price >= 0),
  discount numeric(16,0) not null default 0 check (discount >= 0 and discount <= quantity * unit_price)
);
create table public.payment_evidence (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  version integer not null check (version > 0),
  storage_path text not null unique,
  claimed_amount numeric(16,0) not null check (claimed_amount >= 0),
  verified_amount numeric(16,0) check (verified_amount >= 0),
  transfer_reference text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewer_id uuid references public.profiles(id),
  reviewed_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  unique (order_id,version)
);
create table public.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  driver_id uuid references public.profiles(id),
  source_branch_id uuid references public.branches(id),
  status text not null default 'planned' check (status in ('planned','dispatched','held','replaced','handed_over','cancelled')),
  active boolean not null default true,
  original_consignment_resolved boolean not null default false,
  dispatched_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_active_attempt_per_order on public.delivery_attempts(order_id) where active;
create table public.driver_locations (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.delivery_attempts(id),
  driver_id uuid not null references public.profiles(id),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision not null check (accuracy_m >= 0),
  captured_at timestamptz not null,
  received_at timestamptz not null default now()
);
create table public.retail_sales (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  branch_id uuid not null references public.branches(id),
  actor_id uuid not null references public.profiles(id),
  operation_key uuid not null unique,
  merchandise_total numeric(16,0) not null check (merchandise_total >= 0),
  confirmed_at timestamptz not null default now()
);
create table public.retail_sale_lines (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.retail_sales(id),
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  unit_price numeric(16,0) not null check (unit_price >= 0),
  discount numeric(16,0) not null default 0 check (discount >= 0 and discount <= quantity * unit_price)
);
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  subject_id uuid,
  details jsonb not null default '{}', -- Never include passwords, proof images or raw locations.
  created_at timestamptz not null default now()
);

create function public.audit_account_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events(actor_id,action,subject_id,details)
  values(new.created_by,'account.created',new.id,jsonb_build_object('role',new.role));
  return new;
end;
$$;
revoke all on function public.audit_account_created() from public, anon, authenticated;
create trigger supplylink_account_created after insert on public.profiles
  for each row execute function public.audit_account_created();

create function public.current_portal_role() returns public.portal_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and status = 'active' and not must_change_password
$$;
create function public.current_branch_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select branch_id from public.profiles where id = (select auth.uid()) and status = 'active' and not must_change_password
$$;
revoke all on function public.current_portal_role() from public, anon;
revoke all on function public.current_branch_id() from public, anon;
grant execute on function public.current_portal_role(), public.current_branch_id() to authenticated;

-- Only a real Auth password update clears the first-login restriction.
-- No public RPC can merely flip the flag without changing the password.
create function public.on_auth_password_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles set must_change_password = false where id = new.id and status = 'active';
    insert into public.audit_events(actor_id,action,subject_id) values (new.id,'account.password_changed',new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.on_auth_password_changed() from public, anon, authenticated;
create trigger supplylink_password_changed after update of encrypted_password on auth.users
  for each row execute function public.on_auth_password_changed();

alter table public.profiles enable row level security;
alter table public.branches enable row level security;
alter table public.products enable row level security;
alter table public.inventory enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.payment_evidence enable row level security;
alter table public.delivery_attempts enable row level security;
alter table public.driver_locations enable row level security;
alter table public.retail_sales enable row level security;
alter table public.retail_sale_lines enable row level security;
alter table public.audit_events enable row level security;

create policy profile_read on public.profiles for select to authenticated using (id=(select auth.uid()) or (select public.current_portal_role())='hq');
create policy branches_read on public.branches for select to authenticated using ((select public.current_portal_role()) in ('hq','sme') or ((select public.current_portal_role())='branch' and id=(select public.current_branch_id())));
create policy catalog_read on public.products for select to authenticated using ((select public.current_portal_role())='hq' or (active and (select public.current_portal_role()) in ('sme','branch')));
create policy inventory_read on public.inventory for select to authenticated using ((select public.current_portal_role())='hq' or ((select public.current_portal_role())='branch' and branch_id=(select public.current_branch_id())));
create policy order_read on public.orders for select to authenticated using ((select public.current_portal_role())='hq' or ((select public.current_portal_role())='sme' and sme_id=(select auth.uid())));
create policy order_lines_read on public.order_lines for select to authenticated using (exists (select 1 from public.orders o where o.id=order_id));
create policy evidence_read on public.payment_evidence for select to authenticated using (exists (select 1 from public.orders o where o.id=order_id));
create policy attempt_read on public.delivery_attempts for select to authenticated using ((select public.current_portal_role())='hq' or ((select public.current_portal_role())='driver' and driver_id=(select auth.uid()) and active) or ((select public.current_portal_role())='sme' and exists (select 1 from public.orders o where o.id=order_id)));
create policy location_read on public.driver_locations for select to authenticated using (exists (select 1 from public.delivery_attempts a where a.id=attempt_id and a.active));
create policy retail_sale_read on public.retail_sales for select to authenticated using ((select public.current_portal_role())='hq' or ((select public.current_portal_role())='branch' and branch_id=(select public.current_branch_id())));
create policy retail_line_read on public.retail_sale_lines for select to authenticated using (exists (select 1 from public.retail_sales s where s.id=sale_id));
create policy audit_read on public.audit_events for select to authenticated using ((select public.current_portal_role())='hq');

-- Authenticated clients read through RLS; all operational mutations require scoped,
-- transactional server functions that are deliberately not part of this baseline.
revoke all on public.profiles, public.branches, public.products, public.inventory, public.orders, public.order_lines, public.payment_evidence, public.delivery_attempts, public.driver_locations, public.retail_sales, public.retail_sale_lines, public.audit_events from anon, authenticated;
grant select on public.profiles, public.branches, public.products, public.inventory, public.orders, public.order_lines, public.payment_evidence, public.delivery_attempts, public.driver_locations, public.retail_sales, public.retail_sale_lines, public.audit_events to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

create index orders_sme_created on public.orders(sme_id,created_at desc);
create index orders_status on public.orders(status);
create index order_lines_order on public.order_lines(order_id);
create index evidence_order on public.payment_evidence(order_id);
create index attempts_driver on public.delivery_attempts(driver_id) where active;
create index locations_attempt_capture on public.driver_locations(attempt_id,captured_at desc);
create index retail_branch_confirmed on public.retail_sales(branch_id,confirmed_at);
create index retail_lines_sale on public.retail_sale_lines(sale_id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('payment-evidence','payment-evidence',false,5242880,array['image/jpeg','image/png']);
-- No client upload policy until file-byte validation and order submission are implemented.
create policy evidence_file_read on storage.objects for select to authenticated
using (bucket_id='payment-evidence' and exists (select 1 from public.payment_evidence e where e.storage_path=name));
commit;
