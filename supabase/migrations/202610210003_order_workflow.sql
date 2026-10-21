begin;
alter table public.orders add column payment_instructions text not null default '';
alter table public.orders add column issue_reason text;
alter table public.orders add column resume_status public.order_status;
alter table public.orders add column dispatched_at timestamptz;
alter table public.orders add column refund_required boolean not null default false;
alter table public.orders add column notes text not null default '';
create table public.workflow_settings (
  singleton boolean primary key default true check(singleton),
  shipping_fee numeric(14,0) check(shipping_fee between 0 and 1000000000),
  payment_instructions text not null default '',
  delivery_area text not null default 'Yangon',
  updated_at timestamptz not null default now()
);
insert into public.workflow_settings(singleton) values(true);
create table public.workflow_operations (
  actor_id uuid not null references public.profiles(id),
  operation_key uuid not null,
  fingerprint text not null,
  result jsonb not null,
  primary key(actor_id,operation_key)
);
create table public.proof_uploads (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  actor_id uuid not null references public.profiles(id),
  storage_path text not null unique,
  expires_at timestamptz not null default now()+interval '15 minutes'
);
create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id),
  actor_id uuid not null references public.profiles(id),
  action text not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);
create table public.inventory_movements (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id),
  branch_id uuid references public.branches(id),
  order_id uuid references public.orders(id),
  sale_id uuid references public.retail_sales(id),
  actor_id uuid not null references public.profiles(id),
  kind text not null,
  quantity integer not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique(order_id,product_id,kind),
  unique(sale_id,product_id,kind)
);
create table public.sales_events (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  channel text not null check(channel in ('Wholesale','Retail')),
  order_id uuid unique references public.orders(id),
  sale_id uuid unique references public.retail_sales(id),
  branch_id uuid references public.branches(id),
  merchandise numeric(16,0) not null check(merchandise>=0),
  units integer not null check(units>0),
  occurred_at timestamptz not null default now(),
  check((channel='Wholesale' and order_id is not null and sale_id is null) or (channel='Retail' and sale_id is not null and order_id is null))
);
create index order_events_order_time on public.order_events(order_id,created_at);
create index sales_events_period on public.sales_events(occurred_at,branch_id);
alter table public.workflow_settings enable row level security;
alter table public.workflow_operations enable row level security;
alter table public.proof_uploads enable row level security;
alter table public.order_events enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.sales_events enable row level security;
revoke all on public.workflow_settings,public.workflow_operations,public.proof_uploads,public.order_events,public.inventory_movements,public.sales_events from anon,authenticated;
grant all on public.workflow_settings,public.workflow_operations,public.proof_uploads,public.order_events,public.inventory_movements,public.sales_events to service_role;
grant usage,select on all sequences in schema public to service_role;

create function public.workflow_reserve(p_order uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform i.id from public.inventory i join public.order_lines l on l.product_id=i.product_id
    where l.order_id=p_order and i.branch_id is null order by i.product_id for update of i;
  if exists(select 1 from public.order_lines l left join public.inventory i on i.product_id=l.product_id and i.branch_id is null
    where l.order_id=p_order and (i.id is null or i.on_hand-i.protected_reserve-i.allocated<l.quantity)) then return false; end if;
  update public.inventory i set allocated=i.allocated+l.quantity from public.order_lines l
    where l.order_id=p_order and i.product_id=l.product_id and i.branch_id is null;
  update public.orders set reserved_at=now(),status='Confirmed' where id=p_order;
  return true;
end; $$;
revoke all on function public.workflow_reserve(uuid) from public,anon,authenticated;

create function public.workflow_finish(p_order uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
  select * into o from public.orders where id=p_order for update;
  if o.hq_completed_at is not null and o.sme_received_at is not null and not o.has_open_issue and o.status<>'Cancelled' then
    update public.orders set status='Done',done_at=coalesce(done_at,now()) where id=p_order;
    insert into public.sales_events(reference,channel,order_id,merchandise,units,occurred_at)
      values(o.reference,'Wholesale',o.id,o.merchandise_total,o.item_count,coalesce(o.done_at,now())) on conflict(order_id) do nothing;
    update public.delivery_attempts set active=false where order_id=p_order and active;
  end if;
end; $$;
revoke all on function public.workflow_finish(uuid) from public,anon,authenticated;

create function public.workflow_execute(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
<<workflow>>
declare
  actor public.profiles; o public.orders; p public.products; inv public.inventory; evidence public.payment_evidence;
  attempt public.delivery_attempts; settings public.workflow_settings; proof public.proof_uploads;
  cached public.workflow_operations; item jsonb; row_line record; response jsonb; fingerprint text;
  target uuid; new_id uuid; source_branch uuid; amount numeric; units integer:=0; goods numeric:=0; quantity integer; price numeric;
  decision text; reason text:=trim(coalesce(p_payload->>'reason','')); permitted boolean; restored public.order_status;
begin
  select * into actor from public.profiles where id=auth.uid() and status='active' and not must_change_password;
  if actor.id is null then raise exception 'Sign in with an active account and complete the password change.'; end if;
  if p_key is null then raise exception 'An operation key is required.'; end if;
  fingerprint:=md5(p_action||p_payload::text);
  perform pg_advisory_xact_lock(hashtextextended(actor.id::text||p_key::text,0));
  select * into cached from public.workflow_operations where actor_id=actor.id and operation_key=p_key;
  if found then
    if cached.fingerprint<>fingerprint then raise exception 'This retry key belongs to another request.'; end if;
    return cached.result;
  end if;

  if p_action='configure' then
    if actor.role<>'hq' then raise exception 'Only HQ can configure delivery and payment instructions.'; end if;
    amount:=(p_payload->>'shipping')::numeric;
    if amount is null or amount<>trunc(amount) or amount<0 or amount>1000000000 or length(trim(p_payload->>'instructions'))<5 or length(p_payload->>'instructions')>2000 then raise exception 'Enter a whole-MMK shipping fee and payment instructions.'; end if;
    update public.workflow_settings set shipping_fee=amount,payment_instructions=trim(p_payload->>'instructions'),updated_at=now() where singleton;
    response:=jsonb_build_object('message','Delivery and payment instructions saved.');
  elsif p_action in ('stock','price') then
    if actor.role<>'hq' or length(reason)<3 then raise exception 'HQ access and an adjustment reason are required.'; end if;
    select * into p from public.products where id=(p_payload->>'productId')::uuid and brand='STT' for update;
    if not found then raise exception 'Shoe variant not found.'; end if;
    if p_action='price' then
      price:=(p_payload->>'price')::numeric;
      if price is null or price<>trunc(price) or price<1 or price>1000000000 then raise exception 'Enter a positive whole-MMK wholesale price.'; end if;
      update public.products set wholesale_price=price where id=p.id;
      response:=jsonb_build_object('message','Wholesale price updated. Existing quotes stay unchanged.');
    else
      source_branch:=nullif(p_payload->>'branchId','')::uuid;
      quantity:=(p_payload->>'onHand')::integer;
      if quantity is null or quantity<0 or quantity>1000000 then raise exception 'Enter a valid on-hand quantity.'; end if;
      if source_branch is not null and not exists(select 1 from public.branches where id=source_branch and active) then raise exception 'Active branch not found.'; end if;
      insert into public.inventory(branch_id,product_id) values(source_branch,p.id) on conflict do nothing;
      select * into inv from public.inventory where product_id=p.id and branch_id is not distinct from source_branch for update;
      if quantity<inv.allocated+inv.protected_reserve then raise exception 'On-hand stock cannot fall below protected and allocated stock.'; end if;
      update public.inventory set on_hand=quantity where id=inv.id;
      insert into public.inventory_movements(product_id,branch_id,actor_id,kind,quantity,reason) values(p.id,source_branch,actor.id,'adjustment',quantity-inv.on_hand,reason);
      response:=jsonb_build_object('message','Stock adjustment recorded.');
    end if;
  elsif p_action in ('create','retail') then
    if (p_action='create' and actor.role<>'sme') or (p_action='retail' and actor.role<>'branch') then raise exception 'This account cannot create this type of sale.'; end if;
    if jsonb_typeof(p_payload->'items')<>'array' or jsonb_array_length(p_payload->'items') not between 1 and 30 then raise exception 'Select at least one shoe variant.'; end if;
    if (select count(*) from jsonb_array_elements(p_payload->'items'))<>(select count(distinct x->>'productId') from jsonb_array_elements(p_payload->'items') x) then raise exception 'Each variant must appear only once.'; end if;
    source_branch:=case when p_action='retail' then actor.branch_id else null end;
    if p_action='create' then
      select * into settings from public.workflow_settings where singleton;
      if settings.shipping_fee is null or length(settings.payment_instructions)<5 then raise exception 'HQ must configure shipping and payment instructions before orders can be quoted.'; end if;
      if length(trim(p_payload->>'receiver'))<2 or length(trim(p_payload->>'phone'))<6 or length(trim(p_payload->>'address'))<5 then raise exception 'Enter receiver name, phone and the full Yangon delivery address.'; end if;
      if coalesce(p_payload->>'area','')<>settings.delivery_area then raise exception 'This delivery area needs a quote from HQ.'; end if;
    end if;
    for item in select value from jsonb_array_elements(p_payload->'items') order by value->>'productId' loop
      select * into p from public.products where id=(item->>'productId')::uuid and brand='STT' and active for share;
      if not found then raise exception 'A selected shoe variant is unavailable.'; end if;
      quantity:=(item->>'quantity')::integer;
      if quantity is null or quantity<1 or quantity>1000000 or (p_action='create' and (quantity<p.minimum_packs or quantity%p.minimum_packs<>0)) then raise exception 'Check minimum quantities and whole-pair multiples.'; end if;
      select * into inv from public.inventory where product_id=p.id and branch_id is not distinct from source_branch for update;
      if not found or inv.on_hand-inv.allocated-inv.protected_reserve<quantity then raise exception 'Not enough available stock for %.',p.pack; end if;
      price:=case when p_action='create' then p.wholesale_price else (item->>'price')::numeric end;
      if price is null or price<1 or price<>trunc(price) or price>1000000000 then raise exception 'Enter the actual whole-MMK selling price.'; end if;
      goods:=goods+price*quantity; units:=units+quantity;
    end loop;
    new_id:=gen_random_uuid();
    if p_action='create' then
      if (p_payload->>'expectedTotal')::numeric is distinct from goods+settings.shipping_fee then raise exception 'The quote changed. Refresh the catalog and review the full total again.'; end if;
      insert into public.orders(id,reference,sme_id,business_name,destination,receiver_name,receiver_phone,item_count,merchandise_total,shipping_total,payment_instructions,notes,source_name)
        values(new_id,'STT-'||upper(substr(new_id::text,1,8)),actor.id,actor.name,trim(p_payload->>'address'),trim(p_payload->>'receiver'),trim(p_payload->>'phone'),units,goods,settings.shipping_fee,settings.payment_instructions,left(coalesce(p_payload->>'notes',''),1000),'STT Yangon HQ');
    else
      insert into public.retail_sales(id,reference,branch_id,actor_id,operation_key,merchandise_total) values(new_id,'RS-'||upper(substr(new_id::text,1,8)),source_branch,actor.id,p_key,goods);
    end if;
    for item in select value from jsonb_array_elements(p_payload->'items') loop
      select * into p from public.products where id=(item->>'productId')::uuid;
      quantity:=(item->>'quantity')::integer;
      if p_action='create' then
        insert into public.order_lines(order_id,product_id,product_name,pack_snapshot,quantity,unit_price) values(new_id,p.id,p.name,p.pack,quantity,p.wholesale_price);
      else
        price:=(item->>'price')::numeric;
        insert into public.retail_sale_lines(sale_id,product_id,quantity,unit_price) values(new_id,p.id,quantity,price);
        update public.inventory set on_hand=on_hand-quantity where product_id=p.id and branch_id=source_branch;
        insert into public.inventory_movements(product_id,branch_id,sale_id,actor_id,kind,quantity,reason) values(p.id,source_branch,new_id,actor.id,'retail',-quantity,'Posted retail sale');
      end if;
    end loop;
    if p_action='retail' then
      insert into public.sales_events(reference,channel,sale_id,branch_id,merchandise,units) select reference,'Retail',id,branch_id,merchandise_total,units from public.retail_sales where id=new_id;
    else
      insert into public.order_events(order_id,actor_id,action) values(new_id,actor.id,'Quote saved');
    end if;
    response:=jsonb_build_object('orderId',new_id,'message',case when p_action='create' then 'Order quote saved. Submit full-payment evidence next.' else 'Retail sale posted and stock updated.' end);
  else
    target:=(p_payload->>'orderId')::uuid;
    select * into o from public.orders where id=target for update;
    if not found then raise exception 'Order not found.'; end if;
    select * into attempt from public.delivery_attempts where order_id=o.id and active;
    permitted:=actor.role='hq' or (actor.role='sme' and o.sme_id=actor.id) or (actor.role='driver' and attempt.driver_id=actor.id);
    if not coalesce(permitted,false) then raise exception 'This order is not available to your account.'; end if;
    if p_action='proof_read' then
      if actor.role not in ('hq','sme') then raise exception 'Payment evidence is private to HQ and the ordering SME.'; end if;
      select * into evidence from public.payment_evidence where id=(p_payload->>'evidenceId')::uuid and order_id=o.id;
      if not found then raise exception 'Payment evidence not found.'; end if;
      return jsonb_build_object('path',evidence.storage_path);
    elsif p_action='proof_intent' then
      if actor.role<>'sme' or o.sme_id<>actor.id or o.status not in ('Draft','Awaiting verification') or o.payment_verified_at is not null then raise exception 'Only the ordering SME can submit evidence before payment approval.'; end if;
      if length(coalesce(p_payload->>'digest',''))<>64 then raise exception 'Validated image digest required.'; end if;
      new_id:=gen_random_uuid();
      insert into public.proof_uploads(id,order_id,actor_id,storage_path) values(new_id,o.id,actor.id,o.id::text||'/'||new_id::text||'.png');
      response:=jsonb_build_object('intentId',new_id,'path',o.id::text||'/'||new_id::text||'.png');
    elsif p_action='submit_evidence' then
      if actor.role<>'sme' or o.sme_id<>actor.id or o.status not in ('Draft','Awaiting verification') or o.payment_verified_at is not null then raise exception 'Payment evidence cannot be submitted in this order state.'; end if;
      amount:=(p_payload->>'amount')::numeric;
      if amount is distinct from o.merchandise_total+o.shipping_total then raise exception 'Transfer the full quoted total, including shipping.'; end if;
      if length(trim(p_payload->>'reference'))<3 or length(p_payload->>'reference')>120 then raise exception 'Enter the transfer reference.'; end if;
      select * into proof from public.proof_uploads where id=(p_payload->>'intentId')::uuid and actor_id=actor.id and order_id=o.id and expires_at>now();
      if not found or not exists(select 1 from storage.objects where bucket_id='payment-evidence' and name=proof.storage_path) then raise exception 'Upload a validated proof image before submitting.'; end if;
      insert into public.payment_evidence(order_id,version,storage_path,claimed_amount,transfer_reference)
        select o.id,coalesce(max(version),0)+1,proof.storage_path,amount,trim(p_payload->>'reference') from public.payment_evidence where order_id=o.id;
      update public.orders set status='Awaiting verification' where id=o.id;
      response:=jsonb_build_object('message','Payment evidence submitted for HQ verification.');
    elsif p_action='review_payment' then
      if actor.role<>'hq' or o.status<>'Awaiting verification' or o.reserved_at is not null then raise exception 'HQ can review payment only before order confirmation.'; end if;
      select * into evidence from public.payment_evidence where order_id=o.id order by version desc limit 1 for update;
      if evidence.id is null or evidence.id is distinct from (p_payload->>'evidenceId')::uuid or evidence.status<>'pending' then raise exception 'Refresh the latest pending evidence before reviewing.'; end if;
      decision:=p_payload->>'decision';
      if decision='reject' then
        if length(reason)<3 then raise exception 'Explain why the evidence was rejected.'; end if;
        update public.payment_evidence set status='rejected',reviewer_id=actor.id,reviewed_at=now(),reason=workflow.reason where id=evidence.id;
        response:=jsonb_build_object('message','Evidence rejected. The SME can upload a corrected proof.');
      elsif decision='approve' then
        amount:=(p_payload->>'verifiedAmount')::numeric;
        if amount is distinct from o.merchandise_total+o.shipping_total then raise exception 'The actual verified transfer must match the full order total.'; end if;
        if coalesce((p_payload->>'bankChecked')::boolean,false)=false then raise exception 'Check the actual receiving account before approval.'; end if;
        update public.payment_evidence set status='approved',verified_amount=amount,reviewer_id=actor.id,reviewed_at=now(),reason='Actual full transfer checked by HQ' where id=evidence.id;
        update public.orders set payment_verified_at=now() where id=o.id;
        permitted:=public.workflow_reserve(o.id);
        response:=jsonb_build_object('message',case when permitted then 'Full payment verified, stock reserved and order confirmed.' else 'Full payment verified. Stock is insufficient; HQ action is required before confirmation.' end);
      else raise exception 'Choose approve or reject.'; end if;
    elsif p_action='confirm' then
      if actor.role<>'hq' or o.status<>'Awaiting verification' or o.payment_verified_at is null or o.reserved_at is not null then raise exception 'Full payment must be verified before stock confirmation.'; end if;
      if not public.workflow_reserve(o.id) then raise exception 'Stock is still insufficient for the complete order.'; end if;
      response:=jsonb_build_object('message','Stock reserved and order confirmed.');
    elsif p_action='assign' then
      if actor.role<>'hq' or o.status not in ('Confirmed','Preparing') then raise exception 'Assign a driver after payment and stock confirmation.'; end if;
      if not exists(select 1 from public.profiles where id=(p_payload->>'driverId')::uuid and role='driver' and status='active' and not must_change_password) then raise exception 'Choose an active driver who has completed their password change.'; end if;
      update public.delivery_attempts set active=false,status='cancelled' where order_id=o.id and active and status='planned';
      insert into public.delivery_attempts(order_id,driver_id) values(o.id,(p_payload->>'driverId')::uuid);
      response:=jsonb_build_object('message','Driver assigned.');
    elsif p_action='prepare' then
      if actor.role<>'hq' or o.status<>'Confirmed' or o.payment_verified_at is null or o.reserved_at is null then raise exception 'Only a fully paid, reserved order can enter preparation.'; end if;
      update public.orders set status='Preparing' where id=o.id;
      response:=jsonb_build_object('message','Order is being prepared.');
    elsif p_action='dispatch' then
      if actor.role<>'hq' or o.status<>'Preparing' or o.has_open_issue or o.dispatched_at is not null or attempt.id is null then raise exception 'Prepare the order and assign an active driver before dispatch.'; end if;
      if not exists(select 1 from public.profiles where id=attempt.driver_id and role='driver' and status='active' and not must_change_password) then raise exception 'The assigned driver is no longer active.'; end if;
      perform i.id from public.inventory i join public.order_lines l on l.product_id=i.product_id where l.order_id=o.id and i.branch_id is null order by i.product_id for update of i;
      for row_line in select * from public.order_lines where order_id=o.id loop
        update public.inventory set on_hand=on_hand-row_line.quantity,allocated=allocated-row_line.quantity where product_id=row_line.product_id and branch_id is null and allocated>=row_line.quantity and on_hand>=row_line.quantity;
        if not found then raise exception 'The reserved stock could not be dispatched.'; end if;
        insert into public.inventory_movements(product_id,order_id,actor_id,kind,quantity,reason) values(row_line.product_id,o.id,actor.id,'dispatch',-row_line.quantity,'Wholesale dispatch');
      end loop;
      update public.delivery_attempts set status='dispatched',dispatched_at=now() where id=attempt.id;
      update public.orders set status='Shipping',dispatched_at=now() where id=o.id;
      response:=jsonb_build_object('message','Order dispatched. Stock consumed once.');
    elsif p_action='handover' then
      if actor.role<>'driver' or attempt.driver_id<>actor.id or o.status<>'Shipping' or o.has_open_issue or attempt.status<>'dispatched' then raise exception 'Only the assigned driver can report this active handover.'; end if;
      update public.delivery_attempts set status='handed_over' where id=attempt.id;
      response:=jsonb_build_object('message','Handover reported. SME receipt remains a separate confirmation.');
    elsif p_action='receive' then
      if actor.role<>'sme' or o.sme_id<>actor.id or o.status not in ('Shipping','Complete') or o.has_open_issue or o.sme_received_at is not null then raise exception 'Only the ordering SME can confirm full receipt of an active delivery.'; end if;
      if coalesce((p_payload->>'fullReceipt')::boolean,false)=false then raise exception 'Confirm that every ordered pair was actually received.'; end if;
      update public.orders set sme_received_at=now() where id=o.id;
      perform public.workflow_finish(o.id);
      response:=jsonb_build_object('message','Full receipt confirmed. Done requires HQ completion as well.');
    elsif p_action='complete' then
      if actor.role<>'hq' or o.status<>'Shipping' or o.has_open_issue or attempt.status is distinct from 'handed_over' then raise exception 'The driver must report handover and all issues must be resolved before HQ completion.'; end if;
      update public.orders set status='Complete',hq_completed_at=now() where id=o.id;
      perform public.workflow_finish(o.id);
      response:=jsonb_build_object('message','HQ fulfilment completed. Done requires SME receipt as well.');
    elsif p_action='hold' then
      if o.status not in ('Preparing','Shipping','Complete') or length(reason)<3 then raise exception 'Report an issue with a clear reason on an active order.'; end if;
      if actor.role='sme' and o.status='Preparing' then raise exception 'Contact HQ about changes before dispatch.'; end if;
      update public.orders set resume_status=status,status='On hold',has_open_issue=true,issue_reason=reason where id=o.id;
      response:=jsonb_build_object('message','Issue recorded. HQ must resolve the hold.');
    elsif p_action='resolve' then
      if actor.role<>'hq' or o.status<>'On hold' or length(reason)<3 then raise exception 'HQ must record how the delivery issue was resolved.'; end if;
      restored:=coalesce(o.resume_status,'Shipping');
      update public.orders set status=restored,has_open_issue=false,issue_reason=null,resume_status=null where id=o.id;
      perform public.workflow_finish(o.id);
      response:=jsonb_build_object('message','Issue resolved and previous workflow resumed.');
    elsif p_action='cancel' then
      if actor.role not in ('hq','sme') or o.status not in ('Draft','Awaiting verification','Confirmed','Preparing') or length(reason)<3 or (actor.role='sme' and (o.reserved_at is not null or o.payment_verified_at is not null)) then raise exception 'HQ must coordinate cancellation after confirmation or verified payment. Dispatched orders need reconciliation first.'; end if;
      if o.reserved_at is not null then
        perform i.id from public.inventory i join public.order_lines l on l.product_id=i.product_id where l.order_id=o.id and i.branch_id is null order by i.product_id for update of i;
        update public.inventory i set allocated=i.allocated-l.quantity from public.order_lines l where l.order_id=o.id and i.product_id=l.product_id and i.branch_id is null;
      end if;
      update public.orders set status='Cancelled',refund_required=(payment_verified_at is not null) where id=o.id;
      update public.delivery_attempts set active=false,status='cancelled' where order_id=o.id and active;
      response:=jsonb_build_object('message','Order cancelled. Any verified payment needs separate refund follow-up.');
    else raise exception 'Unknown workflow action.'; end if;
    if p_action not in ('proof_intent','proof_read') then
      insert into public.order_events(order_id,actor_id,action,reason) values(o.id,actor.id,p_action,reason);
    end if;
  end if;
  insert into public.audit_events(actor_id,action,subject_id,details) values(actor.id,'workflow.'||p_action,coalesce(target,new_id),jsonb_build_object('reason',reason));
  insert into public.workflow_operations values(actor.id,p_key,fingerprint,response);
  return response;
end; $$;
revoke all on function public.workflow_execute(text,jsonb,uuid) from public,anon;
grant execute on function public.workflow_execute(text,jsonb,uuid) to authenticated;

create function public.workflow_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles; response jsonb;
begin
  select * into actor from public.profiles where id=auth.uid() and status='active' and not must_change_password;
  if actor.id is null then raise exception 'An active signed-in account is required.'; end if;
  if (select count(*) from public.orders)>10000 then raise exception 'The synchronous workspace limit is 10000 orders. Configure paginated reporting before continuing.'; end if;
  select jsonb_build_object(
    'orders',coalesce((select jsonb_agg(jsonb_build_object(
      'id',o.id,'reference',o.reference,'business',o.business_name,'initials',upper(left(o.business_name,2)),
      'location',o.destination,'items',o.item_count,'merchandise',case when actor.role='driver' then 0 else o.merchandise_total end,
      'shipping',case when actor.role='driver' then 0 else o.shipping_total end,'status',o.status,
      'date',to_char(o.created_at at time zone 'Asia/Yangon','YYYY-MM-DD'),
      'salesDate',case when o.done_at is null then null else to_char(o.done_at at time zone 'Asia/Yangon','YYYY-MM-DD') end,'source',o.source_name,
      'workflow',jsonb_build_object('receiver',o.receiver_name,'phone',o.receiver_phone,'notes',o.notes,'paymentVerified',case when actor.role='driver' then false else o.payment_verified_at is not null end,
        'reserved',o.reserved_at is not null,'hqComplete',o.hq_completed_at is not null,'received',o.sme_received_at is not null,'issue',o.issue_reason,'refundRequired',o.refund_required,
        'instructions',case when actor.role='driver' then '' else o.payment_instructions end,
        'driverId',a.driver_id,'driverName',(select name from public.profiles where id=a.driver_id),'handover',a.status='handed_over',
        'lines',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('productId',l.product_id,'name',l.product_name,'variant',l.pack_snapshot,'quantity',l.quantity,'unitPrice',case when actor.role='driver' then null else l.unit_price end))) from public.order_lines l where l.order_id=o.id),'[]'::jsonb),
        'evidence',case when actor.role='driver' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'version',e.version,'amount',e.claimed_amount,'verifiedAmount',e.verified_amount,'reference',e.transfer_reference,'status',e.status,'reason',e.reason,'createdAt',e.created_at) order by e.version desc) from public.payment_evidence e where e.order_id=o.id),'[]'::jsonb) end,
        'events',coalesce((select jsonb_agg(jsonb_build_object('action',ev.action,'reason',ev.reason,'at',ev.created_at,'actor',(select name from public.profiles where id=ev.actor_id)) order by ev.created_at,ev.id) from public.order_events ev where ev.order_id=o.id),'[]'::jsonb)
      )) order by o.created_at desc)
      from public.orders o left join public.delivery_attempts a on a.order_id=o.id and a.active
      where actor.role='hq' or (actor.role='sme' and o.sme_id=actor.id) or (actor.role='driver' and a.driver_id=actor.id)), '[]'::jsonb),
    'products',case when actor.role='driver' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'category',p.category,'pack',p.pack,'price',p.wholesale_price,
      'stock',case when actor.role='sme' then greatest(0,coalesce(i.on_hand-i.allocated-i.protected_reserve,0)) else coalesce(i.on_hand,0) end,
      'reserve',case when actor.role='sme' then 0 else coalesce(i.allocated+i.protected_reserve,0) end,'minimum',p.minimum_packs,'tone',p.tone,'brand',p.brand,'size',p.size,'color',p.color) order by p.color,p.size)
      from public.products p left join public.inventory i on i.product_id=p.id and i.branch_id is not distinct from (case when actor.role='branch' then actor.branch_id else null end) where p.brand='STT' and p.active),'[]'::jsonb) end,
    'branches',case when actor.role='driver' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'address',b.address,'manager',b.manager_name,'sales',0,'stock',coalesce((select sum(on_hand) from public.inventory where branch_id=b.id),0),'lowStock',0)) from public.branches b where b.active and (actor.role in ('hq','sme') or b.id=actor.branch_id)),'[]'::jsonb) end,
    'accounts',case when actor.role='hq' then coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'username',username,'role',role,'status',case when status='active' and not must_change_password then 'Active' else 'Pending setup' end,'affiliation',address)) from public.profiles where role in ('sme','driver')),'[]'::jsonb) else '[]'::jsonb end,
    'retailSales',case when actor.role in ('hq','branch') then coalesce((select jsonb_agg(jsonb_build_object('id',s.reference,'branchId',s.branch_id,'description',coalesce((select string_agg(p.name||' · '||p.pack,', ') from public.retail_sale_lines l join public.products p on p.id=l.product_id where l.sale_id=s.id),'Retail sale'),'amount',s.merchandise_total,'packs',(select sum(quantity) from public.retail_sale_lines where sale_id=s.id),'date',to_char(s.confirmed_at at time zone 'Asia/Yangon','YYYY-MM-DD')) order by s.confirmed_at desc) from public.retail_sales s where actor.role='hq' or s.branch_id=actor.branch_id),'[]'::jsonb) else '[]'::jsonb end,
    'salesEvents',case when actor.role in ('hq','branch') then coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'reference',e.reference,'orderId',e.order_id,'channel',e.channel,'amount',e.merchandise,'units',e.units,'branchId',e.branch_id,'date',to_char(e.occurred_at at time zone 'Asia/Yangon','YYYY-MM-DD'))) from public.sales_events e where actor.role='hq' or (e.channel='Retail' and e.branch_id=actor.branch_id)),'[]'::jsonb) else '[]'::jsonb end,
    'settings',jsonb_build_object('shipping',case when actor.role='driver' then null else s.shipping_fee end,'instructions',case when actor.role='driver' then '' else s.payment_instructions end,'area',s.delivery_area),
    'workflowEnabled',true
  ) into response from public.workflow_settings s where singleton;
  return response;
end; $$;
revoke all on function public.workflow_snapshot() from public,anon;
grant execute on function public.workflow_snapshot() to authenticated;
commit;
