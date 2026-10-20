-- One example supplier brand and one shoe model, stocked by size and colour.
-- Preserve historical rows and order references; do not delete the former sample catalog.
begin;
alter table public.products add column brand text not null default '';
alter table public.products add column size text not null default '';
alter table public.products add column color text not null default '';
update public.products set active=false where sku in ('RICE-24','OIL-12','TEA-24','SUGAR-20','COFFEE-12','BEANS-4');
insert into public.products(sku,name,brand,category,size,color,pack,base_units_per_pack,wholesale_price,minimum_packs,available_packs,tone) values
('STT-EVERYDAY-W38','STT Everyday sneaker','STT','Shoes','38','White','EU 38 · White · 1 pair',1,45000,2,148,'white'),
('STT-EVERYDAY-W39','STT Everyday sneaker','STT','Shoes','39','White','EU 39 · White · 1 pair',1,45000,2,86,'white'),
('STT-EVERYDAY-W40','STT Everyday sneaker','STT','Shoes','40','White','EU 40 · White · 1 pair',1,45000,2,64,'white'),
('STT-EVERYDAY-B38','STT Everyday sneaker','STT','Shoes','38','Black','EU 38 · Black · 1 pair',1,45000,2,18,'black'),
('STT-EVERYDAY-B39','STT Everyday sneaker','STT','Shoes','39','Black','EU 39 · Black · 1 pair',1,45000,2,92,'black'),
('STT-EVERYDAY-B40','STT Everyday sneaker','STT','Shoes','40','Black','EU 40 · Black · 1 pair',1,45000,2,12,'black');
insert into public.inventory(product_id,on_hand) select id,available_packs from public.products where brand='STT';
drop policy catalog_read on public.products;
create policy catalog_read on public.products for select to authenticated using (
  (select public.current_portal_role())='hq' or
  (active and brand='STT' and (select public.current_portal_role()) in ('sme','branch'))
);
commit;
