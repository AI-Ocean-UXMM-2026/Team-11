-- Give the two longyi price tiers clear catalog names and the requested prices.
begin;

do $$
begin
  if not exists (
    select 1 from public.products
    where brand='STT' and category='Longyi' and active and sku like 'LY-%'
  ) then
    raise exception 'Apply the longyi catalog migration before the price tier migration.';
  end if;
end;
$$;

update public.products
set name=case when sku like 'LY-P%' then 'Premium Longyi' else 'Normal Longyi' end,
    wholesale_price=case when sku like 'LY-P%' then 80000 else 45000 end
where brand='STT' and category='Longyi' and active and sku like 'LY-%';

commit;
