-- Optional coordinates preserve existing accounts and historic orders.
-- New accounts are validated and provisioned by the HQ-only server action.
begin;
alter table public.profiles add column latitude double precision, add column longitude double precision;
alter table public.profiles add constraint profiles_location_pin check (
  (latitude is null) = (longitude is null) and
  (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))
);
alter table public.orders add column latitude double precision, add column longitude double precision;
alter table public.orders add constraint orders_location_pin check (
  (latitude is null) = (longitude is null) and
  (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))
);

-- Keep the existing atomic creation/retry checks and persist the selected pin
-- with the quoted address. New references use the entire primary UUID.
create or replace function supplylink_private.workflow_execute(p_action text,p_payload jsonb,p_key uuid) returns jsonb
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
      if p_payload ? 'pin' and p_payload->'pin'<>'null'::jsonb then
        if jsonb_typeof(p_payload->'pin')<>'object'
          or jsonb_typeof(p_payload#>'{pin,latitude}') is distinct from 'number'
          or jsonb_typeof(p_payload#>'{pin,longitude}') is distinct from 'number'
          or not ((p_payload#>>'{pin,latitude}')::numeric between -90 and 90)
          or not ((p_payload#>>'{pin,longitude}')::numeric between -180 and 180)
        then raise exception 'Choose a valid delivery location pin.'; end if;
      end if;
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
      insert into public.orders(id,reference,sme_id,business_name,destination,receiver_name,receiver_phone,item_count,merchandise_total,shipping_total,payment_instructions,notes,source_name,latitude,longitude)
        values(new_id,'STT-'||upper(new_id::text),actor.id,actor.name,trim(p_payload->>'address'),trim(p_payload->>'receiver'),trim(p_payload->>'phone'),units,goods,settings.shipping_fee,settings.payment_instructions,left(coalesce(p_payload->>'notes',''),1000),'STT Yangon HQ',(p_payload#>>'{pin,latitude}')::double precision,(p_payload#>>'{pin,longitude}')::double precision);
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

revoke all on function supplylink_private.workflow_execute(text,jsonb,uuid) from public,anon,authenticated;

create or replace function public.workflow_list(p_kind text,p_query jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor public.profiles:=supplylink_private.workspace_actor();
  page_number integer:=coalesce((p_query->>'page')::integer,1);
  page_size integer:=coalesce((p_query->>'pageSize')::integer,25);
  row_count bigint; rows_json jsonb; totals jsonb:='{}';
  search_text text:=lower(trim(coalesce(p_query->>'search','')));
  status_filter text:=coalesce(p_query->>'status','All orders');
  selected_id uuid:=nullif(p_query->>'orderId','')::uuid;
  date_from date:=coalesce((p_query->>'reportFrom')::date,date_trunc('month',now() at time zone 'Asia/Yangon')::date);
  date_to date:=coalesce((p_query->>'reportTo')::date,(now() at time zone 'Asia/Yangon')::date);
  channel_filter text:=coalesce(p_query->>'reportChannel','All channels');
  cutoff timestamptz:=coalesce((p_query->>'reportCutoff')::timestamptz,statement_timestamp());
  page_offset bigint;
begin
  if p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'Invalid query.'; end if;
  if page_number not between 1 and 1000000 or page_size not in (25,50,100) or length(search_text)>120 then raise exception 'Invalid pagination.'; end if;
  if status_filter not in ('All orders','Draft','Awaiting verification','Confirmed','Preparing','Shipping','On hold','Complete','Done','Cancelled') then raise exception 'Invalid order status.'; end if;
  if date_from>date_to or channel_filter not in ('All channels','Retail','Wholesale') or cutoff>statement_timestamp() then raise exception 'Invalid report selection.'; end if;
  if p_kind='orders' then
    select count(*) into row_count from supplylink_private.scoped_orders(actor) o
      where (selected_id is null or o.id=selected_id)
        and (not coalesce((p_query->>'attention')::boolean,false) or o.status in ('Awaiting verification','On hold'))
        and o.created_at<=coalesce((p_query->>'ordersCutoff')::timestamptz,statement_timestamp())
        and (status_filter='All orders' or o.status::text=status_filter)
        and (search_text='' or strpos(lower(o.reference||' '||o.business_name||' '||o.destination),search_text)>0);
    page_number:=least(page_number,greatest(1,ceil(row_count::numeric/page_size)::integer));
    page_offset:=(page_number::bigint-1)*page_size;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',o.id,'reference',o.reference,'business',o.business_name,'initials',upper(left(o.business_name,2)),
      'location',o.destination,'pin',case when o.latitude is null then null else jsonb_build_object('latitude',o.latitude,'longitude',o.longitude) end,'items',o.item_count,'merchandise',case when actor.role in ('driver','branch') then 0 else o.merchandise_total end,
      'shipping',case when actor.role in ('driver','branch') then 0 else o.shipping_total end,'status',o.status,
      'date',to_char(o.created_at at time zone 'Asia/Yangon','YYYY-MM-DD'),
      'salesDate',case when o.done_at is null then null else to_char(o.done_at at time zone 'Asia/Yangon','YYYY-MM-DD') end,'source',o.source_name,
      'workflow',jsonb_build_object('receiver',o.receiver_name,'phone',o.receiver_phone,'notes',o.notes,'paymentVerified',case when actor.role in ('driver','branch') then false else o.payment_verified_at is not null end,
        'reserved',o.reserved_at is not null,'hqComplete',o.hq_completed_at is not null,'received',o.sme_received_at is not null,'issue',o.issue_reason,'refundRequired',o.refund_required,
        'instructions',case when actor.role in ('driver','branch') then '' else o.payment_instructions end,
        'dispatched',o.dispatched_at is not null,'sourceBranchId',o.source_branch_id,'handoffPending',o.handoff_pending,'replacementRequired',o.replacement_required,
        'handoffs',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'branchId',h.branch_id,'branchName',(select name from public.branches where id=h.branch_id),'status',h.status,'resolution',h.original_resolution,'reason',h.reason,'responseReason',h.response_reason,'at',h.created_at) order by h.created_at desc,h.id desc) from public.delivery_handoffs h where h.order_id=o.id),'[]'::jsonb),
        'driverId',case when a.active or o.status in ('Done','Cancelled') then a.driver_id else null end,'driverName',case when a.active or o.status in ('Done','Cancelled') then (select name from public.profiles where id=a.driver_id) else null end,'handover',a.active and a.status='handed_over',
        'lines',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('productId',l.product_id,'name',l.product_name,'variant',l.pack_snapshot,'quantity',l.quantity,'unitPrice',case when actor.role in ('driver','branch') then null else l.unit_price end))) from public.order_lines l where l.order_id=o.id),'[]'::jsonb),
        'evidence',case when actor.role in ('driver','branch') then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'version',e.version,'amount',e.claimed_amount,'verifiedAmount',e.verified_amount,'reference',e.transfer_reference,'status',e.status,'reason',e.reason,'createdAt',e.created_at) order by e.version desc) from public.payment_evidence e where e.order_id=o.id),'[]'::jsonb) end,
        'events',coalesce((select jsonb_agg(jsonb_build_object('action',ev.action,'reason',ev.reason,'at',ev.created_at,'actor',(select name from public.profiles where id=ev.actor_id)) order by ev.created_at,ev.id) from public.order_events ev where ev.order_id=o.id),'[]'::jsonb)
      )) order by o.created_at desc,o.id desc),'[]'::jsonb) into rows_json
      from (select * from supplylink_private.scoped_orders(actor) o
        where (selected_id is null or o.id=selected_id)
        and (not coalesce((p_query->>'attention')::boolean,false) or o.status in ('Awaiting verification','On hold'))
        and o.created_at<=coalesce((p_query->>'ordersCutoff')::timestamptz,statement_timestamp())
          and (status_filter='All orders' or o.status::text=status_filter)
          and (search_text='' or strpos(lower(o.reference||' '||o.business_name||' '||o.destination),search_text)>0)
        order by o.created_at desc,o.id desc limit page_size offset page_offset) o
      left join lateral (select * from public.delivery_attempts where order_id=o.id order by active desc,created_at desc,id desc limit 1) a on true;
  elsif p_kind='retail' then
    if actor.role not in ('hq','branch') then raise exception 'Retail history is restricted to HQ and branch staff.'; end if;
    select count(*) into row_count from public.retail_sales s where actor.role='hq' or s.branch_id=actor.branch_id;
    page_number:=least(page_number,greatest(1,ceil(row_count::numeric/page_size)::integer)); page_offset:=(page_number::bigint-1)*page_size;
    select coalesce(jsonb_agg(jsonb_build_object('id',s.reference,'branchId',s.branch_id,'description',coalesce((select string_agg(p.name||' · '||p.pack,', ') from public.retail_sale_lines l join public.products p on p.id=l.product_id where l.sale_id=s.id),'Retail sale'),'amount',s.merchandise_total,'packs',coalesce((select sum(quantity) from public.retail_sale_lines where sale_id=s.id),0),'date',to_char(s.confirmed_at at time zone 'Asia/Yangon','YYYY-MM-DD')) order by s.confirmed_at desc,s.id desc),'[]'::jsonb) into rows_json
      from (select * from public.retail_sales s where actor.role='hq' or s.branch_id=actor.branch_id order by s.confirmed_at desc,s.id desc limit page_size offset page_offset) s;
  elsif p_kind='transfers' then
    if actor.role not in ('hq','branch') then raise exception 'Transfers are restricted to HQ and branch staff.'; end if;
    select count(*) into row_count from public.stock_transfers t where actor.role='hq' or t.source_branch_id=actor.branch_id or t.destination_branch_id=actor.branch_id;
    page_number:=least(page_number,greatest(1,ceil(row_count::numeric/page_size)::integer)); page_offset:=(page_number::bigint-1)*page_size;
    select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'reference',t.reference,'sourceBranchId',t.source_branch_id,'destinationBranchId',t.destination_branch_id,'source',coalesce((select name from public.branches where id=t.source_branch_id),'STT Yangon HQ'),'destination',coalesce((select name from public.branches where id=t.destination_branch_id),'STT Yangon HQ'),'productId',t.product_id,'variant',(select pack from public.products where id=t.product_id),'quantity',t.quantity,'status',t.status,'reason',t.reason,'createdAt',t.created_at) order by t.created_at desc,t.id desc),'[]'::jsonb) into rows_json
      from (select * from public.stock_transfers t where actor.role='hq' or t.source_branch_id=actor.branch_id or t.destination_branch_id=actor.branch_id order by t.created_at desc,t.id desc limit page_size offset page_offset) t;
  elsif p_kind='report' then
    if actor.role not in ('hq','branch') then raise exception 'Sales reports are restricted to HQ and branch staff.'; end if;
    select count(*),jsonb_build_object('wholesale',coalesce(sum(e.merchandise) filter(where e.channel='Wholesale'),0),'retail',coalesce(sum(e.merchandise) filter(where e.channel='Retail'),0)) into row_count,totals
      from public.sales_events e
      where (actor.role='hq' or (e.channel='Retail' and e.branch_id=actor.branch_id))
        and e.occurred_at>=date_from::timestamp at time zone 'Asia/Yangon' and e.occurred_at<(date_to+1)::timestamp at time zone 'Asia/Yangon'
        and e.occurred_at<=cutoff and (channel_filter='All channels' or e.channel=channel_filter);
    page_number:=least(page_number,greatest(1,ceil(row_count::numeric/page_size)::integer)); page_offset:=(page_number::bigint-1)*page_size;
    select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'reference',e.reference,'orderId',e.order_id,'channel',e.channel,'amount',e.merchandise,'units',e.units,'branchId',e.branch_id,'date',to_char(e.occurred_at at time zone 'Asia/Yangon','YYYY-MM-DD')) order by e.occurred_at desc,e.id desc),'[]'::jsonb) into rows_json
      from (select * from public.sales_events e
        where (actor.role='hq' or (e.channel='Retail' and e.branch_id=actor.branch_id))
          and e.occurred_at>=date_from::timestamp at time zone 'Asia/Yangon' and e.occurred_at<(date_to+1)::timestamp at time zone 'Asia/Yangon'
          and e.occurred_at<=cutoff and (channel_filter='All channels' or e.channel=channel_filter)
        order by e.occurred_at desc,e.id desc limit page_size offset page_offset) e;
  else raise exception 'Unknown list.';
  end if;
  return jsonb_build_object('rows',rows_json,'total',row_count,'page',page_number,'pageSize',page_size,'summary',totals,'cutoff',cutoff);
end; $$;
revoke all on function public.workflow_list(text,jsonb) from public,anon;
grant execute on function public.workflow_list(text,jsonb) to authenticated;


create or replace function public.workflow_snapshot(p_query jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor public.profiles:=supplylink_private.workspace_actor(); response jsonb;
  order_page jsonb; retail_page jsonb; transfer_page jsonb; report_page jsonb;
  selected_order jsonb:=null; stats jsonb;
  empty_page jsonb:=jsonb_build_object('rows','[]'::jsonb,'total',0,'page',1,'pageSize',coalesce((p_query->>'pageSize')::integer,25));
  query jsonb:=p_query-'orderId';
begin
  order_page:=public.workflow_list('orders',query||jsonb_build_object('page',coalesce((query->>'ordersPage')::integer,1)));
  retail_page:=empty_page; transfer_page:=empty_page; report_page:=empty_page;
  if actor.role in ('hq','branch') then
    retail_page:=public.workflow_list('retail',query||jsonb_build_object('page',coalesce((query->>'retailPage')::integer,1)));
    transfer_page:=public.workflow_list('transfers',query||jsonb_build_object('page',coalesce((query->>'transfersPage')::integer,1)));
    report_page:=public.workflow_list('report',query||jsonb_build_object('page',coalesce((query->>'reportPage')::integer,1)));
  end if;
  if nullif(p_query->>'orderId','') is not null then
    selected_order:=(public.workflow_list('orders',jsonb_build_object('orderId',p_query->>'orderId'))->'rows')->0;
  end if;
  select jsonb_build_object('orders',count(*),'active',count(*) filter(where status not in ('Done','Cancelled','Draft')),'awaiting',count(*) filter(where status='Awaiting verification'),'held',count(*) filter(where status='On hold'),'shipping',count(*) filter(where status='Shipping'),'wholesale',case when actor.role in ('hq','sme') then coalesce(sum(merchandise_total) filter(where status='Done'),0) else 0 end)
    into stats from supplylink_private.scoped_orders(actor);
  stats:=stats||jsonb_build_object(
    'retail',case when actor.role in ('hq','branch') then coalesce((select sum(merchandise_total) from public.retail_sales where actor.role='hq' or branch_id=actor.branch_id),0) else 0 end,
    'retailCount',retail_page->'total',
    'pendingTransfers',case when actor.role in ('hq','branch') then (select count(*) from public.stock_transfers where status in ('reserved','shipping') and (actor.role='hq' or source_branch_id=actor.branch_id or destination_branch_id=actor.branch_id)) else 0 end);
  select jsonb_build_object(
    'orders',order_page->'rows',
    'attentionOrders',public.workflow_list('orders',jsonb_build_object('attention',true))->'rows',
    'products',case when actor.role='driver' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'category',p.category,'pack',p.pack,'price',p.wholesale_price,
      'stock',case when actor.role='sme' then greatest(0,coalesce(i.on_hand-i.allocated-i.protected_reserve,0)) else coalesce(i.on_hand,0) end,
      'reserve',case when actor.role='sme' then 0 else coalesce(i.allocated+i.protected_reserve,0) end,'minimum',p.minimum_packs,'tone',p.tone,'brand',p.brand,'size',p.size,'color',p.color) order by p.color,p.size)
      from public.products p left join public.inventory i on i.product_id=p.id and i.branch_id is not distinct from (case when actor.role='branch' then actor.branch_id else null end) where p.brand='STT' and p.active),'[]'::jsonb) end,
    'branches',case when actor.role='driver' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'address',b.address,'manager',b.manager_name,'active',b.active,'closedAt',b.closed_at,
      'driverCount',(select count(*) from public.profiles where branch_id=b.id and role='driver' and status='active'),
      'staffCount',(select count(*) from public.profiles where branch_id=b.id and role='branch' and status='active'),
      'inventory',case when actor.role='hq' then coalesce((select jsonb_agg(jsonb_build_object('productId',p.id,'variant',p.pack,'onHand',coalesce(i.on_hand,0),'allocated',coalesce(i.allocated,0),'protected',coalesce(i.protected_reserve,0))) from public.products p left join public.inventory i on i.product_id=p.id and i.branch_id=b.id where p.brand='STT' and p.active),'[]'::jsonb) else '[]'::jsonb end,'sales',case when actor.role in ('hq','branch') then coalesce((select sum(merchandise_total) from public.retail_sales where branch_id=b.id),0) else 0 end,'stock',coalesce((select sum(on_hand) from public.inventory where branch_id=b.id),0),'lowStock',(select count(*) from public.inventory where branch_id=b.id and on_hand-protected_reserve-allocated<10))) from public.branches b where (actor.role='hq' or b.active) and (actor.role in ('hq','sme') or b.id=actor.branch_id)),'[]'::jsonb) end,
    'accounts',case when actor.role in ('hq','branch') then coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'username',p.username,'phone',case when actor.role='hq' then p.phone else null end,'pin',case when actor.role='hq' and p.latitude is not null then jsonb_build_object('latitude',p.latitude,'longitude',p.longitude) else null end,'role',p.role,'branchId',p.branch_id,'branchName',coalesce(b.name,'STT Yangon HQ'),'status',case when p.status='suspended' then 'Suspended' when p.must_change_password then 'Pending setup' else 'Active' end,'affiliation',case when p.role in ('branch','driver') then coalesce(b.name,'STT Yangon HQ') else p.address end)) from public.profiles p left join public.branches b on b.id=p.branch_id where (actor.role='hq' and p.role in ('sme','driver','branch')) or (actor.role='branch' and p.role='driver' and p.branch_id=actor.branch_id)),'[]'::jsonb) else '[]'::jsonb end,
    'settings',jsonb_build_object('shipping',case when actor.role in ('driver','branch') then null else s.shipping_fee end,'instructions',case when actor.role in ('driver','branch') then '' else s.payment_instructions end,'area',s.delivery_area),
    'retailSales',retail_page->'rows','salesEvents',report_page->'rows','transfers',transfer_page->'rows',
    'selectedOrder',selected_order,'summary',stats,
    'report',coalesce(report_page->'summary','{}'::jsonb)||jsonb_build_object('cutoff',report_page->'cutoff'),
    'pagination',jsonb_build_object('orders',order_page-'rows'-'summary'-'cutoff','retail',retail_page-'rows','transfers',transfer_page-'rows','report',report_page-'rows'-'summary'-'cutoff'),
    'query',query||jsonb_strip_nulls(jsonb_build_object('orderId',p_query->>'orderId','ordersPage',order_page->'page','retailPage',retail_page->'page','transfersPage',transfer_page->'page','reportPage',report_page->'page','pageSize',order_page->'pageSize','reportFrom',coalesce(query->>'reportFrom',to_char(date_trunc('month',now() at time zone 'Asia/Yangon'),'YYYY-MM-DD')),'reportTo',coalesce(query->>'reportTo',to_char(now() at time zone 'Asia/Yangon','YYYY-MM-DD')),'reportCutoff',report_page->>'cutoff')),
    'workflowEnabled',true
  ) into response from public.workflow_settings s where singleton;
  return response;
end; $$;
revoke all on function public.workflow_snapshot(jsonb) from public,anon;
grant execute on function public.workflow_snapshot(jsonb) to authenticated;

commit;
