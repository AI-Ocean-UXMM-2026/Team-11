// Demo-only transport. Hosted deployments use Supabase Postgres Changes with RLS.
const runtime = globalThis as typeof globalThis & {
  deliveryListeners?: Map<string, Set<() => void>>;
};
export function subscribeDemoTracking(orderId: string, changed: () => void) {
  const listeners = (runtime.deliveryListeners ??= new Map());
  const group = listeners.get(orderId) ?? new Set<() => void>();
  listeners.set(orderId, group);
  group.add(changed);
  return () => {
    group.delete(changed);
    if (!group.size) listeners.delete(orderId);
  };
}
export function notifyDemoTracking(orderId?: string) {
  if (orderId)
    runtime.deliveryListeners?.get(orderId)?.forEach((changed) => changed());
  else
    runtime.deliveryListeners?.forEach((listeners) =>
      listeners.forEach((changed) => changed()),
    );
}
