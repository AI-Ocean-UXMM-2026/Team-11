import {
  keepPreviousData,
  queryOptions,
  hashKey,
  type QueryClient,
} from "@tanstack/react-query";
import type { Viewer, WorkspaceData } from "../domain";
import type { WorkspaceQuery } from "./query";

export class WorkspaceRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function workspaceScope(
  viewer: Pick<Viewer, "id" | "role">,
  demo: boolean,
) {
  return ["workspace", viewer.id, viewer.role, demo] as const;
}
export type WorkspaceScope = ReturnType<typeof workspaceScope>;

export function normalizedQuery(query: WorkspaceQuery): WorkspaceQuery {
  return {
    ordersPage: 1,
    retailPage: 1,
    transfersPage: 1,
    reportPage: 1,
    pageSize: 25,
    search: "",
    status: "All orders",
    reportChannel: "All channels",
    ...query,
  };
}
export const workspaceKey = (scope: WorkspaceScope, query: WorkspaceQuery) =>
  [...scope, normalizedQuery(query)] as const;

export async function fetchWorkspace(
  query: WorkspaceQuery,
  signal?: AbortSignal,
): Promise<WorkspaceData> {
  const params = new URLSearchParams({ query: JSON.stringify(query) });
  const response = await fetch(`/api/workflow?${params}`, {
    signal,
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok || !result.data)
    throw new WorkspaceRequestError(
      result.error ?? "Unable to load records.",
      response.status,
    );
  return result.data;
}

export function workspaceOptions(scope: WorkspaceScope, query: WorkspaceQuery) {
  return queryOptions({
    queryKey: workspaceKey(scope, query),
    queryFn: ({ signal }) => fetchWorkspace(query, signal),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: (count, error) =>
      count < 1 &&
      !(error instanceof WorkspaceRequestError && error.status < 500),
  });
}

// Cancel old reads before accepting a mutation response. Update that selection
// and mark every other cached page stale, including inactive pages.
export async function acceptWorkspaceSnapshot(
  client: QueryClient,
  scope: WorkspaceScope,
  next: WorkspaceData,
) {
  await client.cancelQueries({ queryKey: scope });
  await client.invalidateQueries({ queryKey: scope, refetchType: "none" });
  client.setQueryData(workspaceKey(scope, next.query ?? {}), next);
  await client.refetchQueries({ queryKey: scope, type: "active", stale: true });
}

export function sameWorkspaceQuery(a: WorkspaceQuery, b: WorkspaceQuery) {
  return hashKey([normalizedQuery(a)]) === hashKey([normalizedQuery(b)]);
}
