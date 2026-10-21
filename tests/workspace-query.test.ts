import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, it, expect, vi } from "vitest";
import {
  acceptWorkspaceSnapshot,
  workspaceKey,
  workspaceOptions,
  workspaceScope,
} from "../src/lib/workflow/client";
import type { WorkspaceData } from "../src/lib/domain";

const scope = workspaceScope({ id: "hq-one", role: "hq" }, true);
const clients: QueryClient[] = [];
const makeClient = () => {
  const client = new QueryClient();
  clients.push(client);
  return client;
};
const pageData = (page: number): WorkspaceData => ({
  orders: [],
  products: [],
  branches: [],
  accounts: [],
  retailSales: [],
  query: { ordersPage: page },
  pagination: {
    orders: { page, pageSize: 25, total: 75 },
    retail: { page: 1, pageSize: 25, total: 0 },
    transfers: { page: 1, pageSize: 25, total: 0 },
    report: { page: 1, pageSize: 25, total: 0 },
  },
});
const response = (page: number) => Response.json({ data: pageData(page) });

it("uses focus and reconnect refresh without interval polling", () => {
  const options = workspaceOptions(scope, {});
  expect(options.refetchInterval).toBe(false);
  expect(options.refetchOnWindowFocus).toBe(true);
  expect(options.refetchOnReconnect).toBe(true);
});
afterEach(() => {
  clients.forEach((c) => c.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});

it("caches pages separately and reuses a fresh page without another request", async () => {
  const fetch = vi.fn(async (url: string) =>
    response(
      JSON.parse(new URL(url, "http://localhost").searchParams.get("query")!)
        .ordersPage,
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const client = makeClient();
  await client.fetchQuery(workspaceOptions(scope, { ordersPage: 1 }));
  await client.fetchQuery(workspaceOptions(scope, { ordersPage: 2 }));
  const first = await client.fetchQuery(
    workspaceOptions(scope, { ordersPage: 1 }),
  );
  expect(first.query!.ordersPage).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("keeps the previous page visible until the next page arrives", async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  const client = makeClient();
  client.setQueryData(workspaceKey(scope, { ordersPage: 1 }), pageData(1));
  const observer = new QueryObserver(
    client,
    workspaceOptions(scope, { ordersPage: 1 }),
  );
  const unsubscribe = observer.subscribe(() => {});
  observer.setOptions(workspaceOptions(scope, { ordersPage: 2 }));
  expect(observer.getCurrentResult()).toMatchObject({
    isPlaceholderData: true,
    data: { query: { ordersPage: 1 } },
  });
  resolve(response(2));
  await vi.waitFor(() =>
    expect(observer.getCurrentResult()).toMatchObject({
      isPlaceholderData: false,
      data: { query: { ordersPage: 2 } },
    }),
  );
  unsubscribe();
});

it("aborts an obsolete page request when filters change", async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = options.signal as AbortSignal;
          signals.push(signal);
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    ),
  );
  const client = makeClient();
  const observer = new QueryObserver(
    client,
    workspaceOptions(scope, { ordersPage: 1 }),
  );
  const unsubscribe = observer.subscribe(() => {});
  observer.setOptions(
    workspaceOptions(scope, { ordersPage: 1, search: "new selection" }),
  );
  expect(signals).toHaveLength(2);
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
  unsubscribe();
  expect(signals[1].aborted).toBe(true);
});

it("invalidates inactive pages after a mutation without changing another viewer's cache", async () => {
  const client = makeClient();
  const foreign = workspaceScope({ id: "another-hq", role: "hq" }, true);
  client.setQueryData(workspaceKey(scope, { ordersPage: 1 }), pageData(1));
  client.setQueryData(workspaceKey(scope, { ordersPage: 2 }), pageData(2));
  client.setQueryData(workspaceKey(foreign, { ordersPage: 1 }), pageData(1));
  await acceptWorkspaceSnapshot(client, scope, pageData(2));
  expect(
    client.getQueryState(workspaceKey(scope, { ordersPage: 1 }))!.isInvalidated,
  ).toBe(true);
  expect(
    client.getQueryState(workspaceKey(scope, { ordersPage: 2 }))!.isInvalidated,
  ).toBe(false);
  expect(
    client.getQueryState(workspaceKey(foreign, { ordersPage: 1 }))!
      .isInvalidated,
  ).toBe(false);
});

it("keys caches by viewer, role, mode, page and filters", () => {
  const key = workspaceKey(scope, { ordersPage: 2, search: "shoes" });
  expect(key).not.toEqual(
    workspaceKey(scope, { ordersPage: 1, search: "shoes" }),
  );
  expect(key).not.toEqual(
    workspaceKey(scope, { ordersPage: 2, search: "other" }),
  );
  expect(key).not.toEqual(
    workspaceKey(workspaceScope({ id: "hq-one", role: "driver" }, true), {
      ordersPage: 2,
      search: "shoes",
    }),
  );
  expect(key).not.toEqual(
    workspaceKey(workspaceScope({ id: "hq-one", role: "hq" }, false), {
      ordersPage: 2,
      search: "shoes",
    }),
  );
});

it("does not retry an unauthorised request", async () => {
  const fetch = vi.fn(async () =>
    Response.json({ error: "Sign in again." }, { status: 401 }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    makeClient().fetchQuery(workspaceOptions(scope, {})),
  ).rejects.toThrow("Sign in again.");
  expect(fetch).toHaveBeenCalledTimes(1);
});
