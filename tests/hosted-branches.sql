-- Run in the configured Supply Link development project. No fixtures are retained.
begin;
do $$
declare
  hq uuid; v_branch_id uuid; staff uuid:=gen_random_uuid(); v_sku uuid;
  response jsonb; snapshot jsonb; transfer_id uuid; retry uuid:=gen_random_uuid();
  payload jsonb; sales_before bigint;
begin
  select id into hq from public.profiles where username='hq.admin' and role='hq' and status='active';
  if hq is null then raise exception 'Active HQ account required.'; end if;
  select id into v_sku from public.products p where brand='STT' and active order by p.sku limit 1;
  select count(*) into sales_before from public.sales_events;
  -- This first-login bypass exists only inside the rolled-back verification transaction.
  update public.profiles set must_change_password=false where id=hq;
  perform set_config('request.jwt.claim.sub',hq::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',hq,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  payload:=jsonb_build_object('name','Rollback branch '||staff::text,'manager','Verification only','address','Verification only, Yangon');
  response:=public.workflow_execute('branch_create',payload,retry);
  v_branch_id:=(response->>'branchId')::uuid;
  if v_branch_id is null or public.workflow_execute('branch_create',payload,retry)->>'branchId'<>v_branch_id::text then raise exception 'Branch creation or retry failed.'; end if;
  if not exists(select 1 from jsonb_array_elements(public.workflow_snapshot()->'branches') b where b->>'id'=v_branch_id::text) then raise exception 'New branch absent from HQ snapshot.'; end if;
  execute 'reset role';
  if (select count(*) from public.inventory i where i.branch_id=v_branch_id)<>6 or exists(select 1 from public.inventory i where i.branch_id=v_branch_id and (on_hand<>0 or allocated<>0)) then raise exception 'Initial branch stock incorrect.'; end if;
  insert into auth.users(id) values(staff);
  insert into public.profiles(id,username,name,role,branch_id,must_change_password) values(staff,'qa.'||replace(staff::text,'-',''),'Rollback branch staff','branch',v_branch_id,false);
  -- Preserve any real reservations while providing disposable stock for this transfer.
  update public.inventory set on_hand=on_hand+10 where product_id=v_sku and public.inventory.branch_id is null;
  execute 'set local role authenticated';
  response:=public.workflow_execute('transfer_create',jsonb_build_object('productId',v_sku,'quantity',2,'destinationBranchId',v_branch_id,'reason','Rollback verification refill'),gen_random_uuid());
  transfer_id:=(response->>'transferId')::uuid;
  perform public.workflow_execute('transfer_dispatch',jsonb_build_object('transferId',transfer_id,'confirmed',true),gen_random_uuid());
  perform set_config('request.jwt.claim.sub',staff::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
  snapshot:=public.workflow_snapshot();
  if jsonb_array_length(snapshot->'branches')<>1 or snapshot->'branches'->0->>'id'<>v_branch_id::text then raise exception 'Branch scope failed.'; end if;
  retry:=gen_random_uuid(); payload:=jsonb_build_object('transferId',transfer_id,'confirmed',true);
  perform public.workflow_execute('transfer_receive',payload,retry);
  perform public.workflow_execute('transfer_receive',payload,retry);
  execute 'reset role';
  if (select on_hand from public.inventory i where i.branch_id=v_branch_id and product_id=v_sku)<>2 then raise exception 'Receipt or retry stock failed.'; end if;
  if (select count(*) from public.sales_events)<>sales_before then raise exception 'Stock transfer created revenue.'; end if;
end;
$$;
rollback;
select 'PASS: HQ branch creation and retry, six zero-stock variants, scoped staff portal, refill dispatch/receipt and retry; all fixtures rolled back' as result;

