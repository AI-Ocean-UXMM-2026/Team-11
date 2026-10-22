begin;

-- Allow HQ to split a returned, previously dispatched consignment across a
-- branch backup phase and a later HQ phase. The older all-or-nothing handoff
-- remains available when the branch can supply the full order.
alter function public.workflow_execute(text,jsonb,uuid)
  rename to workflow_execute_before_returned_recovery;
alter function public.workflow_execute_before_returned_recovery(text,jsonb,uuid)
  set schema supplylink_private;
revoke all on function supplylink_private.workflow_execute_before_returned_recovery(text,jsonb,uuid)
  from public,anon,authenticated;

create function public.workflow_execute(p_action text,p_payload jsonb,p_key uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor public.profiles:=supplylink_private.workspace_actor();
  target uuid;
  o public.orders;
  cached public.workflow_operations;
  fingerprint text;
  order_line record;
  result jsonb;
begin
  if p_action='phase_request' and nullif(p_payload->>'orderId','') is not null then
    target:=(p_payload->>'orderId')::uuid;
    fingerprint:=md5(p_action||p_payload::text);
    perform pg_advisory_xact_lock(hashtextextended(actor.id::text||p_key::text,0));
    select * into cached
      from public.workflow_operations
      where actor_id=actor.id and operation_key=p_key;
    if found then
      if cached.fingerprint<>fingerprint then
        raise exception 'This retry key belongs to another request.';
      end if;
      return cached.result;
    end if;

    select * into o from public.orders where id=target for update;
    if actor.role='hq'
      and o.id is not null
      and exists(select 1 from supplylink_private.scoped_orders(actor) scoped where scoped.id=o.id)
      and o.handoff_pending=false
      and o.dispatched_at is not null
      and o.status='On hold'
      and o.has_open_issue
      and o.source_branch_id is null
      and not exists(
        select 1 from supplylink_private.fulfilment_phases p
        where p.order_id=o.id
      )
      and (
        (o.replacement_required and exists(
          select 1
          from public.delivery_handoffs h
          join public.delivery_attempts a on a.id=h.previous_attempt_id
          where h.order_id=o.id
            and h.original_resolution='returned_to_hq'
            and h.status in ('cancelled','declined')
            and a.original_consignment_resolved
            and a.status='replaced'
        ))
        or
        (not o.replacement_required
          and coalesce((p_payload->>'returnedConsignmentConfirmed')::boolean,false)
          and exists(
            select 1 from public.delivery_attempts a
            where a.order_id=o.id and a.active and a.status in ('dispatched','held')
              and not a.original_consignment_resolved
          ))
      )
    then
      if o.replacement_required then
        -- The existing branch request already reconciled and added the returned
        -- stock to HQ on hand. Restore only the order allocation here.
        for order_line in
          select product_id,quantity
          from public.order_lines
          where order_id=o.id
          order by product_id
        loop
          update public.inventory
            set allocated=allocated+order_line.quantity
            where branch_id is null
              and product_id=order_line.product_id
              and on_hand-allocated>=order_line.quantity;
          if not found then
            raise exception 'Returned HQ stock is no longer available to reserve. Review inventory before planning a replacement.';
          end if;
        end loop;
      else
        -- This recovery can also start directly from a held dispatched order.
        -- The HQ user must explicitly confirm physical return before stock is
        -- restored and the old attempt is closed.
        for order_line in
          select product_id,quantity
          from public.order_lines
          where order_id=o.id
          order by product_id
        loop
          update public.inventory
            set on_hand=on_hand+order_line.quantity,
                allocated=allocated+order_line.quantity
            where branch_id is null
              and product_id=order_line.product_id
              and on_hand>=allocated;
          if not found then
            raise exception 'HQ inventory is unavailable to receive the returned consignment. Review inventory before planning a replacement.';
          end if;
          insert into public.inventory_movements(product_id,order_id,actor_id,kind,quantity,reason)
            select order_line.product_id,o.id,actor.id,'return_original:'||a.id::text,
              order_line.quantity,trim(coalesce(p_payload->>'reason','Returned original consignment'))
            from public.delivery_attempts a
            where a.order_id=o.id and a.active and a.status in ('dispatched','held')
            order by a.created_at desc,a.id desc limit 1;
        end loop;
        update public.delivery_attempts
          set active=false,status='replaced',original_consignment_resolved=true
          where order_id=o.id and active and status in ('dispatched','held');
      end if;

      update public.orders
        set status='Confirmed',
            source_branch_id=null,
            source_name='Ocean Pride Longyi HQ',
            handoff_pending=false,
            replacement_required=false,
            has_open_issue=false,
            issue_reason=null,
            resume_status=null,
            dispatched_at=null
        where id=o.id;
    end if;
  end if;

  result:=supplylink_private.workflow_execute_before_returned_recovery(p_action,p_payload,p_key);
  return result;
end;
$$;

revoke all on function public.workflow_execute(text,jsonb,uuid) from public,anon;
grant execute on function public.workflow_execute(text,jsonb,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
