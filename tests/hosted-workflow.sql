-- Run only in the configured Supply Link development project.
-- All fixture identities, stock, orders and evidence metadata are rolled back.
begin;
do $$
declare
  hq uuid; buyer uuid:=gen_random_uuid(); other_buyer uuid:=gen_random_uuid(); driver uuid:=gen_random_uuid();
  sku uuid; price numeric; order_id uuid; proof_id uuid; proof_path text; evidence_id uuid;
  response jsonb; snapshot jsonb; tracking jsonb; attempt_id uuid; retry uuid:=gen_random_uuid();
begin
  select id into hq from public.profiles where username='hq.admin' and role='hq' and status='active';
  if hq is null then raise exception 'Bootstrap HQ before this check.'; end if;
  select p.id,p.wholesale_price into sku,price from public.products p where p.brand='STT' and p.active order by p.sku limit 1;
  insert into auth.users(id) values(buyer),(other_buyer),(driver);
  insert into public.profiles(id,username,name,role,must_change_password) values
    (buyer,'qa.'||replace(buyer::text,'-',''),'Rollback buyer','sme',false),
    (other_buyer,'qa.'||replace(other_buyer::text,'-',''),'Rollback other buyer','sme',false),
    (driver,'qa.'||replace(driver::text,'-',''),'Rollback driver','driver',false);
  -- Only this uncommitted transaction can see the temporary first-login bypass.
  update public.profiles set must_change_password=false where id=hq;
  perform set_config('request.jwt.claim.sub',hq::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',hq,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  snapshot:=public.workflow_snapshot('{}'::jsonb);
  if snapshot is null or not (snapshot ? 'pagination') or not (snapshot ? 'summary') then raise exception 'Paginated HQ workspace failed.'; end if;
  perform public.workflow_execute('configure',jsonb_build_object('shipping',5000,'instructions','ROLLBACK TEST ONLY. No real transfer.'),gen_random_uuid());
  perform public.workflow_execute('stock',jsonb_build_object('productId',sku,'onHand',20,'reason','ROLLBACK TEST ONLY'),gen_random_uuid());
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',buyer,'role','authenticated')::text,true);
  response:=public.workflow_execute('create',jsonb_build_object('items',jsonb_build_array(jsonb_build_object('productId',sku,'quantity',2)),'receiver','Rollback receiver','phone','09000000000','address','ROLLBACK TEST ONLY, Yangon','area','Yangon','expectedTotal',price*2+5000),retry);
  order_id:=(response->>'orderId')::uuid;
  if (public.workflow_execute('create',jsonb_build_object('items',jsonb_build_array(jsonb_build_object('productId',sku,'quantity',2)),'receiver','Rollback receiver','phone','09000000000','address','ROLLBACK TEST ONLY, Yangon','area','Yangon','expectedTotal',price*2+5000),retry)->>'orderId')::uuid<>order_id then raise exception 'Order idempotency failed.'; end if;
  response:=public.workflow_execute('proof_intent',jsonb_build_object('orderId',order_id,'digest',repeat('a',64)),gen_random_uuid());
  proof_id:=(response->>'intentId')::uuid; proof_path:=response->>'path';
  execute 'reset role';
  insert into storage.objects(bucket_id,name) values('payment-evidence',proof_path);
  execute 'set local role authenticated';
  perform public.workflow_execute('submit_evidence',jsonb_build_object('orderId',order_id,'intentId',proof_id,'amount',price*2+5000,'reference','ROLLBACK TEST ONLY'),gen_random_uuid());
  snapshot:=public.workflow_snapshot();
  evidence_id:=(snapshot->'orders'->0->'workflow'->'evidence'->0->>'id')::uuid;
  perform set_config('request.jwt.claim.sub',other_buyer::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_buyer,'role','authenticated')::text,true);
  if jsonb_array_length(public.workflow_snapshot()->'orders')<>0 or (select count(*) from public.orders)<>0 then raise exception 'Other SME can see private orders.'; end if;
  perform set_config('request.jwt.claim.sub',hq::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',hq,'role','authenticated')::text,true);
  perform public.workflow_execute('review_payment',jsonb_build_object('orderId',order_id,'evidenceId',evidence_id,'decision','approve','verifiedAmount',price*2+5000,'bankChecked',true),gen_random_uuid());
  perform public.workflow_execute('assign',jsonb_build_object('orderId',order_id,'driverId',driver),gen_random_uuid());
  perform public.workflow_execute('prepare',jsonb_build_object('orderId',order_id),gen_random_uuid());
  retry:=gen_random_uuid();
  perform public.workflow_execute('dispatch',jsonb_build_object('orderId',order_id),retry);
  perform public.workflow_execute('dispatch',jsonb_build_object('orderId',order_id),retry);
  perform set_config('request.jwt.claim.sub',driver::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',driver,'role','authenticated')::text,true);
  snapshot:=public.workflow_snapshot();
  if jsonb_array_length(snapshot->'orders')<>1 or (snapshot->'orders'->0->>'merchandise')::numeric<>0 or jsonb_array_length(snapshot->'orders'->0->'workflow'->'evidence')<>0 then raise exception 'Driver DTO privacy check failed.'; end if;
  if (select count(*) from public.payment_evidence)<>0 then raise exception 'Driver can read evidence metadata.'; end if;
  begin
    perform public.workflow_execute('handover',jsonb_build_object('orderId',order_id),gen_random_uuid());
    raise exception 'Handover allowed before pickup.';
  exception when others then
    if sqlerrm not like 'Confirm pickup before%' then raise; end if;
  end;
  retry:=gen_random_uuid();
  response:=public.workflow_execute('pickup',jsonb_build_object('orderId',order_id),retry);
  attempt_id:=(response->>'attemptId')::uuid;
  perform public.workflow_execute('pickup',jsonb_build_object('orderId',order_id),retry);
  perform public.workflow_tracking_publish(order_id,attempt_id,'sharing',jsonb_build_object('latitude',16.84,'longitude',96.17,'accuracy',12,'capturedAt',clock_timestamp()));
  tracking:=public.workflow_tracking(order_id);
  if tracking->'point' is null or tracking->'point'='null'::jsonb or tracking->>'state'<>'sharing' then raise exception 'Synthetic driver location failed.'; end if;
  perform set_config('request.jwt.claim.sub',other_buyer::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_buyer,'role','authenticated')::text,true);
  begin
    perform public.workflow_tracking(order_id);
    raise exception 'Other buyer can read driver location.';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.delivery_tracking)<>0 then raise exception 'Tracking RLS leaked a location.'; end if;
  perform set_config('request.jwt.claim.sub',driver::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',driver,'role','authenticated')::text,true);
  perform public.workflow_execute('handover',jsonb_build_object('orderId',order_id),gen_random_uuid());
  tracking:=public.workflow_tracking(order_id);
  if tracking->>'state'<>'stopped' or tracking->'point'<>'null'::jsonb then raise exception 'Handover did not clear location.'; end if;
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',buyer,'role','authenticated')::text,true);
  perform public.workflow_execute('receive',jsonb_build_object('orderId',order_id,'fullReceipt',true),gen_random_uuid());
  perform set_config('request.jwt.claim.sub',hq::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',hq,'role','authenticated')::text,true);
  snapshot:=public.workflow_snapshot();
  if exists(select 1 from jsonb_array_elements(snapshot->'salesEvents') e where e->>'orderId'=order_id::text) then raise exception 'Sale recognized before HQ completion.'; end if;
  perform public.workflow_execute('complete',jsonb_build_object('orderId',order_id),gen_random_uuid());
  snapshot:=public.workflow_snapshot();
  if snapshot->'orders'->0->>'status'<>'Done' or (select count(*) from jsonb_array_elements(snapshot->'salesEvents') e where e->>'orderId'=order_id::text)<>1 then raise exception 'Done/sales event check failed.'; end if;
  execute 'reset role';
end;
$$;
rollback;
select 'PASS: paginated HQ workspace, role isolation, private evidence, payment/reservation, dispatch/pickup retry, synthetic GPS, tracking RLS and cleanup, two confirmations and one sale; all test records rolled back' as result;
