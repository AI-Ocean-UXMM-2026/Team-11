-- Let an SME update only its own saved delivery address and map coordinates.
begin;

grant update (address, latitude, longitude) on public.profiles to authenticated;

create policy profiles_update_own_sme_delivery_location
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) and role = 'sme')
  with check (id = (select auth.uid()) and role = 'sme');

comment on policy profiles_update_own_sme_delivery_location on public.profiles is
  'SMEs may update their own saved delivery location fields only.';

commit;
