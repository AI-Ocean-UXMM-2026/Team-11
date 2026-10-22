"use client";
import { LocationLink } from "./location-link";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  workspaceScope,
  workspaceOptions,
  workspaceKey,
  sameWorkspaceQuery,
  acceptWorkspaceSnapshot,
  WorkspaceRequestError,
} from "@/lib/workflow/client";
import {
  ArrowDownToLine,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Boxes,
  Building2,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  CreditCard,
  LayoutDashboard,
  Leaf,
  LogOut,
  MapPin,
  Menu,
  Package,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  Truck,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  businessDate,
  money,
  total,
  merchandiseSales,
  roleNames,
  type Order,
  type Product,
  type Role,
  type Viewer,
  type WorkspaceData,
} from "@/lib/domain";
import { provisionAccount, signOut } from "@/app/actions";
import { workflowAction } from "@/app/workflow-actions";
import { Pagination } from "./pagination";
import { PhoneField } from "./phone-field";
import { LocationPicker } from "./location-picker";
import { pinFromForm, locationSchema } from "@/lib/contact";
import type { WorkspaceQuery, ListKind } from "@/lib/workflow/query";
import { OrderWorkflow } from "./order-workflow";
import { DriverTrackingNotice } from "./delivery-tracking";
import { BranchDetail } from "./branch-detail";
import { BranchNetwork, StockTransfers } from "./branch-network";
import { DriverManagement } from "./driver-management";
import { WorkflowAdmin } from "./workflow-admin";
import { NetworkArt } from "./network-art";
import { SmeCheckout } from "./sme-checkout";
import { SmeOrdersTable } from "./sme-orders-table";
import { StockPlanning } from "./stock-planning";
import { workspaceHref, portalLogin } from "@/lib/portals";

type Nav = { key: string; label: string; icon: LucideIcon; badge?: string };
const navigations: Record<Role, Nav[]> = {
  hq: [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "orders", label: "Wholesale orders", icon: ClipboardList },
    { key: "inventory", label: "Shoes & stock", icon: Package },
    { key: "branches", label: "Branches", icon: Store },
    { key: "drivers", label: "Driver", icon: Truck },
    { key: "accounts", label: "Accounts & access", icon: Users },
    { key: "reports", label: "Reports", icon: Wallet },
    { key: "stock-planning", label: "Stock Planning", icon: Package },
  ],
  sme: [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "catalog", label: "STT catalog", icon: ShoppingBag },
    { key: "orders", label: "My orders", icon: ClipboardList },
    { key: "locations", label: "Supplier locations", icon: MapPin },
  ],
  branch: [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "deliveries", label: "Branch deliveries", icon: Truck },
    { key: "sales", label: "Retail sales", icon: ShoppingBag },
    { key: "inventory", label: "Branch stock", icon: Package },
    { key: "reports", label: "Sales reports", icon: Wallet },
  ],
  driver: [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "deliveries", label: "My deliveries", icon: Truck },
    { key: "help", label: "Driver guide", icon: CircleHelp },
  ],
};
const sectionTitles: Record<string, string> = {
  orders: "Wholesale orders",
  inventory: "Shoes & stock",
  branches: "Your branch network",
  drivers: "Driver",
  accounts: "Accounts & access",
  reports: "Sales & operations",
  "stock-planning": "Stock Planning",
  settings: "Workspace settings",
  catalog: "STT shoe catalog",
  locations: "Supplier locations",
  sales: "Retail sales",
  deliveries: "Your deliveries",
  help: "A little help, when you need it",
};
function Icon({
  icon: Component,
  ...props
}: {
  icon: LucideIcon;
  size?: number;
  className?: string;
}) {
  return (
    <Component
      aria-hidden="true"
      size={props.size ?? 19}
      strokeWidth={1.7}
      {...props}
    />
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span
      className={`badge badge-${status.toLowerCase().replaceAll(" ", "-")}`}
    >
      <span className="status-dot" />
      {status}
    </span>
  );
}
function Modal({
  title,
  children,
  close,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-labelledby="modal-title"
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-header">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          onClick={close}
          aria-label="Close dialog"
        >
          <Icon icon={X} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function Workspace({
  data: initialData,
  viewer,
  demo,
  section,
  branchId,
  restoreOrderId,
  planningBranchId,
}: {
  data: WorkspaceData;
  viewer: Viewer;
  demo: boolean;
  section: string;
  branchId?: string;
  restoreOrderId?: string;
  planningBranchId?: string;
}) {
  const [query, setQuery] = useState<WorkspaceQuery>(initialData.query ?? {});
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState(initialData.query?.search ?? "");
  const [statusFilter, setStatusFilter] = useState(
    initialData.query?.status ?? "All orders",
  );
  const [issuedCredentials, setIssuedCredentials] = useState<{
    username: string;
    password: string;
    role: "sme" | "driver" | "branch";
  } | null>(null);
  const [accountRole, setAccountRole] = useState<"sme" | "driver" | "branch">(
    "sme",
  );
  const [mobileNav, setMobileNav] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const [modal, setModal] = useState<
    "account" | "notifications" | "help" | "sale" | null
  >(null);
  const [selected, setSelected] = useState<Order | null>(
    restoreOrderId ? (initialData.selectedOrder ?? null) : null,
  );
  const [toast, setToast] = useState("");
  const [formError, setFormError] = useState("");
  const [pending, startTransition] = useTransition();
  const [reportChannel, setReportChannel] = useState(
    initialData.query?.reportChannel ??
      (viewer.role === "branch" ? "Retail" : "All channels"),
  );
  const [reportFrom, setReportFrom] = useState(
    () =>
      initialData.query?.reportFrom ??
      businessDate(new Date().toISOString()).slice(0, 7) + "-01",
  );
  const [reportTo, setReportTo] = useState(
    () => initialData.query?.reportTo ?? businessDate(new Date().toISOString()),
  );
  const router = useRouter();
  const role = viewer.role;
  const queryClient = useQueryClient();
  const scope = workspaceScope(viewer, demo);
  const effectiveQuery = { ...query, orderId: selected?.id };
  const snapshot = useQuery({
    ...workspaceOptions(scope, effectiveQuery),
    refetchInterval: role === "hq" ? 30_000 : false,
    initialData: sameWorkspaceQuery(effectiveQuery, initialData.query ?? {})
      ? initialData
      : undefined,
  });
  const data = snapshot.data ?? initialData;
  const loading = snapshot.isPending || snapshot.isPlaceholderData;
  const loadError = snapshot.error?.message ?? "";

  const operationRetry = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!narrow || !mobileNav) return;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () =>
      Array.from(
        navRef.current?.querySelectorAll<HTMLElement>(
          "a[href],button:not(:disabled)",
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNav(false);
      if (event.key !== "Tab") return;
      const items = controls(),
        first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [narrow, mobileNav]);
  useEffect(() => {
    const next = snapshot.data;
    if (snapshot.isPlaceholderData || !next?.query) return;
    const { orderId: _orderId, ...canonical } = next.query;
    // Pin the server's report cutoff and clamped page into the cache before
    // changing keys, so the same report selection never fetches twice.
    if (!sameWorkspaceQuery(query, canonical)) {
      queryClient.setQueryData(
        workspaceKey(scope, { ...canonical, orderId: selected?.id }),
        next,
      );
      setQuery(canonical);
    }
    if (selected && next.query.orderId === selected.id) {
      setSelected(next.selectedOrder ?? null);
    }
  }, [
    snapshot.data,
    snapshot.isPlaceholderData,
    query,
    selected?.id,
    queryClient,
    viewer.id,
    role,
    demo,
  ]);
  useEffect(() => {
    if (
      snapshot.error instanceof WorkspaceRequestError &&
      [401, 403].includes(snapshot.error.status)
    ) {
      queryClient.clear();
      window.location.assign(portalLogin(role));
    }
  }, [snapshot.error, queryClient, role]);
  useEffect(() => {
    if (section !== "orders" && section !== "overview") return;
    const timer = setTimeout(() => {
      setQuery((previous) => {
        if (
          (previous.search ?? "") === search &&
          (previous.status ?? "All orders") === statusFilter
        )
          return previous;
        return { ...previous, search, status: statusFilter, ordersPage: 1 };
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [search, statusFilter, section]);
  useEffect(() => {
    if (!reportFrom || !reportTo || reportFrom > reportTo) return;
    setQuery((previous) => {
      if (
        previous.reportFrom === reportFrom &&
        previous.reportTo === reportTo &&
        (previous.reportChannel ?? "All channels") === reportChannel
      )
        return previous;
      return {
        ...previous,
        reportFrom,
        reportTo,
        reportChannel: reportChannel as WorkspaceQuery["reportChannel"],
        reportPage: 1,
        reportCutoff: undefined,
      };
    });
  }, [reportFrom, reportTo, reportChannel]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  function open(which: typeof modal) {
    if (which === "account" && demo && !viewer.authenticated) {
      router.push("/hq/login");
      return;
    }
    setFormError("");
    setModal(which);
  }
  const href = (key: string) => workspaceHref(role, key, demo);
  const nav = navigations[role];
  const attention = data.attentionOrders ?? data.orders;
  const awaiting = attention.filter(
    (o) => o.status === "Awaiting verification",
  );
  const held = attention.filter((o) => o.status === "On hold");
  const summary = data.summary ?? {
    orders: data.orders.length,
    active: 0,
    awaiting: awaiting.length,
    held: held.length,
    shipping: 0,
    wholesale: merchandiseSales(data.orders),
    retail: 0,
    retailCount: data.retailSales.length,
    pendingTransfers: 0,
  };
  const retail = summary.retail;
  const refillRequests = role === "hq" ? (data.refillRequests ?? []) : [];
  const refillRequestCount =
    role === "hq" ? (data.refillRequestCount ?? refillRequests.length) : 0;
  const notificationCount =
    summary.awaiting + summary.held + refillRequestCount;
  const matchedOrders = data.orders;
  const matchedProducts = data.products.filter((p) =>
    `${p.name} ${p.brand} ${p.size} ${p.color}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const reportEvents = data.salesEvents ?? [];
  const reportWholesale = data.report?.wholesale ?? 0;
  const reportRetail = data.report?.retail ?? 0;
  const filtersPending =
    (section === "orders" || section === "overview") &&
    ((data.query?.search ?? "") !== search ||
      (data.query?.status ?? "All orders") !== statusFilter);
  const reportPending =
    !reportFrom ||
    !reportTo ||
    reportFrom > reportTo ||
    data.query?.reportFrom !== reportFrom ||
    data.query?.reportTo !== reportTo ||
    (data.query?.reportChannel ?? "All channels") !== reportChannel;
  function pageControls(kind: ListKind, label: string) {
    const field = {
      orders: "ordersPage",
      retail: "retailPage",
      transfers: "transfersPage",
      report: "reportPage",
    }[kind];
    return (
      <Pagination
        info={data.pagination?.[kind]}
        label={label}
        busy={loading || filtersPending || (kind === "report" && reportPending)}
        change={(page, pageSize) =>
          setQuery((previous) => ({
            ...previous,
            ...(pageSize !== previous.pageSize
              ? {
                  ordersPage: 1,
                  retailPage: 1,
                  transfersPage: 1,
                  reportPage: 1,
                }
              : {}),
            pageSize,
            [field]: page,
          }))
        }
      />
    );
  }
  async function exportRecords(kind: "orders" | "report") {
    if (
      loading ||
      loadError ||
      filtersPending ||
      (kind === "report" && reportPending)
    )
      return;
    setExporting(true);
    try {
      const parameters = new URLSearchParams({
        kind,
        query: JSON.stringify(data.query ?? {}),
      });
      const response = await fetch(`/api/workflow/export?${parameters}`);
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "Export failed.");
      }
      // Wait for the complete response before creating a download. A failed
      // stream must never leave a seemingly successful, truncated CSV.
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `supplylink-${kind}.csv`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setToast("All matching records exported.");
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Export interrupted. Please retry.",
      );
    } finally {
      setExporting(false);
    }
  }
  function exportReport() {
    void exportRecords("report");
  }
  async function openOrder(id: string) {
    const current = data.orders.find((o) => o.id === id);
    if (current) {
      setSelected(current);
      return;
    }
    try {
      const next = await queryClient.fetchQuery(
        workspaceOptions(scope, { ...query, orderId: id }),
      );
      if (next.selectedOrder) setSelected(next.selectedOrder);
      else setToast("This order is no longer available.");
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Unable to open the order.",
      );
    }
  }
  async function applySnapshot(next: WorkspaceData, message?: string) {
    setSelected((previous) =>
      previous
        ? next.query?.orderId === previous.id
          ? (next.selectedOrder ?? null)
          : (next.orders.find((o) => o.id === previous.id) ?? previous)
        : null,
    );
    if (message) setToast(message);
    await acceptWorkspaceSnapshot(queryClient, scope, next);
  }
  function refreshReport() {
    const next = { ...query, reportPage: 1, reportCutoff: undefined };
    queryClient.removeQueries({
      queryKey: workspaceKey(scope, { ...next, orderId: selected?.id }),
      exact: true,
    });
    setQuery(next);
  }
  function mutate(
    action: string,
    payload: Record<string, unknown>,
    onSuccess?: (next: WorkspaceData, id?: string) => void,
  ) {
    const fingerprint = JSON.stringify([action, payload]);
    if (operationRetry.current?.fingerprint !== fingerprint)
      operationRetry.current = { fingerprint, key: crypto.randomUUID() };
    const key = operationRetry.current.key;
    setFormError("");
    startTransition(async () => {
      try {
        const result = await workflowAction(
          action,
          payload,
          key,
          effectiveQuery,
        );
        if (result.error) {
          setFormError(result.error);
          return;
        }
        operationRetry.current = null;
        if (result.data) {
          await applySnapshot(result.data, result.result?.message);
          onSuccess?.(result.data, result.result?.orderId);
        }
      } catch {
        setFormError(
          "Connection interrupted. Retry the same details to check the result.",
        );
      }
    });
  }
  function createAccount(form: FormData) {
    const pin = locationSchema.safeParse(pinFromForm(form));
    if (!pin.success) {
      setFormError("Choose the account location on the map.");
      return;
    }
    const input = {
      name: String(form.get("name") ?? "").trim(),
      role: String(form.get("role")) as "sme" | "driver" | "branch",
      phone: String(form.get("phone") ?? ""),
      phoneCountry: String(form.get("phoneCountry") ?? "MM"),
      pin: pin.data,
      branchId: String(form.get("branchId") ?? ""),
    };
    setFormError("");
    startTransition(async () => {
      try {
        const result = await provisionAccount(input);
        if (result.error || !result.username || !result.temporaryPassword) {
          setFormError(result.error ?? "Could not issue login credentials.");
          return;
        }
        // Preserve the one-time credentials before refreshing the account list.
        setModal(null);
        setIssuedCredentials({
          username: result.username,
          password: result.temporaryPassword,
          role: input.role,
        });
        await queryClient.invalidateQueries({ queryKey: scope });
        router.refresh();
      } catch {
        setFormError(
          "Connection interrupted. Check the account directory before trying again.",
        );
      }
    });
  }

  function createSale(form: FormData) {
    mutate(
      "retail",
      {
        items: [
          {
            productId: String(form.get("product")),
            quantity: Number(form.get("quantity")),
            price: Number(form.get("price")),
          },
        ],
      },
      () => setModal(null),
    );
  }

  const orderTable = (limit?: number) =>
    role === "sme" ? (
      <SmeOrdersTable
        orders={matchedOrders.slice(0, limit)}
        openOrder={setSelected}
      />
    ) : (
      <div className="table-scroll">
        <table className="orders-table">
          <thead>
            <tr>
              <th>Order / business</th>
              <th>Order value</th>
              <th>Status</th>
              <th className="date-column">Placed on</th>
              <th>
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {matchedOrders.slice(0, limit).map((o) => (
              <tr key={o.id}>
                <td>
                  <button
                    className="business-cell"
                    onClick={() => setSelected(o)}
                  >
                    <span
                      className={`avatar avatar-${Number(o.id.slice(-1)) % 3}`}
                    >
                      {o.initials}
                    </span>
                    <span>
                      <strong>{o.business}</strong>
                      <small>
                        {o.reference} <span className="dot-separator">·</span>{" "}
                        {o.items} pairs
                      </small>
                    </span>
                  </button>
                </td>
                <td className="amount">
                  {money(total(o))}
                  <small>MMK</small>
                </td>
                <td>
                  <Badge status={o.status} />
                </td>
                <td className="date-column muted">
                  {new Date(o.date + "T00:00:00Z").toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  })}
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`View ${o.reference}`}
                    onClick={() => setSelected(o)}
                  >
                    <Icon icon={ChevronRight} size={17} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {matchedOrders.length === 0 && (
          <Empty
            icon={ClipboardList}
            title="No orders here yet"
            text={
              search
                ? "Try another business name or order reference."
                : "Orders matching this selection will appear here."
            }
          />
        )}
      </div>
    );
  const branchPanel = (
    <section className="panel branch-panel">
      <div className="panel-heading">
        <h2>Branch health</h2>
        <Link
          className="text-link"
          href={href(role === "sme" ? "locations" : "branches")}
        >
          View all <Icon icon={ArrowUpRight} size={15} />
        </Link>
      </div>
      {data.branches
        .filter((b) => b.active !== false)
        .map((b) => (
          <div className="branch-row" key={b.id}>
            <span className="branch-icon">
              <Icon icon={Store} size={20} />
            </span>
            <div>
              <strong>{b.name}</strong>
              <span>
                {role === "hq"
                  ? `${money(b.sales)} MMK in retail sales`
                  : b.pin
                    ? "Map location"
                    : b.address}
              </span>
              {role !== "hq" && b.pin && (
                <LocationLink pin={b.pin} label="View location pin" />
              )}
            </div>
            {role === "hq" && (
              <span
                className={`health-dot ${b.lowStock ? "warning" : ""}`}
                title={
                  b.lowStock
                    ? `${b.lowStock} low-stock products`
                    : "Healthy stock"
                }
              />
            )}
          </div>
        ))}
      <div className="panel-note">
        <Icon icon={ShieldCheck} size={16} />
        <span>
          {demo
            ? "Wholesale reserves stay protected."
            : "Wholesale reserves stay protected."}
        </span>
      </div>
    </section>
  );

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        ref={navRef}
        inert={narrow && !mobileNav}
        aria-label="Workspace navigation"
        className={`sidebar ${mobileNav ? "is-open" : ""}`}
      >
        <button
          className="icon-button sidebar-close"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        >
          <X size={20} />
        </button>
        <Link href={href("overview")} className="brand">
          <span className="brand-mark">
            <Icon icon={Boxes} size={23} />
          </span>
          Supply<span className="brand-light">Link</span>
        </Link>
        <Link
          className="workspace-switch"
          href="/login"
          aria-label="Choose a portal"
        >
          <span className="workspace-icon">
            <Building2 size={19} />
          </span>
          <div>
            <strong>
              {role === "hq"
                ? "STT Supplier"
                : role === "sme"
                  ? viewer.name
                  : role === "branch"
                    ? (data.branches[0]?.name ?? "Branch workspace")
                    : "Yangon deliveries"}
            </strong>
            <small>{roleNames[role]}</small>
          </div>
          <ChevronDown size={15} />
        </Link>
        <div className="nav-caption">Workspace</div>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <Link
              key={n.key}
              href={href(n.key)}
              className={`nav-item ${section === n.key ? "active" : ""}`}
              aria-current={section === n.key ? "page" : undefined}
              onClick={() => setMobileNav(false)}
            >
              <Icon icon={n.icon} />
              <span>{n.label}</span>
              {n.key === "orders" && summary.awaiting > 0 && (
                <span className="nav-count">{summary.awaiting}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="network-note">
            <span className="leaf-icon">
              <Icon icon={Leaf} size={21} />
            </span>
            <strong>Better, together.</strong>
            <p>
              One connected network.
              <br />
              More room to grow.
            </p>
            <button className="text-link" onClick={() => open("help")}>
              Explore your workspace <ArrowRight size={14} />
            </button>
          </div>
          <Link
            className={`nav-item ${section === "settings" ? "active" : ""}`}
            href={href("settings")}
          >
            <Icon icon={Settings} />
            <span>Settings</span>
          </Link>
          <button className="nav-item" onClick={() => open("help")}>
            <Icon icon={CircleHelp} />
            <span>Help & resources</span>
            <ArrowUpRight size={15} />
          </button>
          <button
            className="profile"
            onClick={() => router.push(href("settings"))}
          >
            <span className="avatar profile-avatar">
              {viewer.name
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </span>
            <span>
              <strong>{viewer.name}</strong>
              <small>
                {role === "hq" ? "Headquarters admin" : roleNames[role]}
              </small>
            </span>
            <ChevronDown size={15} />
          </button>
        </div>
      </aside>
      <div className="workspace-main" inert={narrow && mobileNav}>
        <header className="topbar">
          <div className="topbar-context">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={22} />
            </button>
            <span className="context-role">{roleNames[role]}</span>
            <ChevronRight size={14} />
            <strong>
              {branchId
                ? (data.branches.find((b) => b.id === branchId)?.name ??
                  "Manage branch")
                : section === "overview"
                  ? "Overview"
                  : sectionTitles[section]}
            </strong>
          </div>
          <div className="topbar-tools">
            {demo && (
              <span className="demo-label">
                <span />
                Demo workspace
              </span>
            )}
            <button
              className="icon-button notification-button"
              onClick={() => open("notifications")}
              aria-label={`Notifications, ${notificationCount} action items`}
            >
              <Icon icon={Bell} size={20} />
              {notificationCount > 0 && <i />}
            </button>
            <span className="topbar-divider" />
            <button
              className="avatar top-avatar"
              onClick={() => router.push(href("settings"))}
              aria-label="Account settings"
            >
              {viewer.name
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </button>
          </div>
        </header>
        <main
          id="main"
          className={`main-content${role === "sme" && section === "catalog" ? " catalog-page" : ""}`}
        >
          <DriverTrackingNotice viewer={viewer} />
          <div className="page-heading">
            <div>
              {branchId ? (
                <>
                  <p className="greeting">
                    <Link href="/branches">← Back to branches</Link>
                  </p>
                  <h1>
                    {data.branches.find((b) => b.id === branchId)?.name ??
                      "Manage branch"}
                  </h1>
                  <p className="subtitle">
                    Branch stock, drivers and refill history in one place.
                  </p>
                </>
              ) : section === "overview" ? (
                <>
                  <p className="greeting">
                    Good morning, {viewer.name.split(" ")[0]}{" "}
                    <span className="greeting-line" />
                  </p>
                  <h1>
                    {role === "sme"
                      ? "Let’s keep your shelves stocked."
                      : role === "driver"
                        ? "A good day to get moving."
                        : "Your network, at a glance."}
                  </h1>
                  <p className="subtitle">
                    {role === "hq"
                      ? "A little clarity for everything moving in your business."
                      : role === "sme"
                        ? "Your STT shoe orders and deliveries in one place."
                        : role === "branch"
                          ? "Keep retail moving and your wholesale reserve ready."
                          : "Your assigned deliveries and the details you need."}
                  </p>
                </>
              ) : (
                <>
                  <p className="greeting">Your workspace</p>
                  <h1>
                    {role === "sme" && section === "orders"
                      ? "Your orders"
                      : sectionTitles[section]}
                  </h1>
                  <p className="subtitle">
                    {
                      (
                        {
                          orders:
                            "From first order to final handover. Follow every step.",
                          inventory:
                            "The right stock, in the right place, at the right time.",
                          branches: "Local branches. One connected business.",
                          drivers:
                            "View your drivers and manage their branch affiliations.",
                          accounts:
                            "Bring your business customers and delivery team on board.",
                          reports:
                            "Recorded sales, clear numbers. Shipping stays separate.",
                          "stock-planning":
                            "Branch backup reserves for HQ wholesale deliveries. Set targets, review alerts, and arrange refills.",
                          catalog:
                            "One STT shoe model. Choose the right sizes and colors for your shop.",
                          sales:
                            "Every sale accounted for. Every pack in its place.",
                          settings: "Your account and workspace preferences.",
                          deliveries:
                            "Assigned jobs, delivery details and handovers.",
                          locations:
                            "Find your headquarters and local branches.",
                          help: "A guide to working together on SupplyLink.",
                        } as Record<string, string>
                      )[section]
                    }
                  </p>
                </>
              )}
            </div>
            <div className="heading-actions">
              {section === "overview" ? (
                <>
                  <span className="date-pill">
                    <Icon icon={CalendarDays} size={16} />
                    {new Date().toLocaleDateString("en-GB", {
                      timeZone: "Asia/Yangon",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  {role === "hq" && (
                    <button
                      className="button primary"
                      onClick={() => open("account")}
                    >
                      <Plus size={17} />
                      Create account
                    </button>
                  )}
                  {role === "sme" && (
                    <Link href={href("catalog")} className="button primary">
                      <Plus size={17} />
                      New order
                    </Link>
                  )}
                  {role === "branch" && (
                    <button
                      className="button primary"
                      onClick={() => open("sale")}
                    >
                      <Plus size={17} />
                      Record a sale
                    </button>
                  )}
                </>
              ) : section === "drivers" && role === "hq" ? (
                <button
                  className="button primary"
                  onClick={() => {
                    setAccountRole("driver");
                    open("account");
                  }}
                >
                  <Plus size={17} />
                  Create driver
                </button>
              ) : section === "accounts" ? (
                <button
                  className="button primary"
                  onClick={() => open("account")}
                >
                  <Plus size={17} />
                  Create account
                </button>
              ) : section === "orders" ? (
                <button
                  className="button secondary"
                  disabled={
                    loading || exporting || filtersPending || !!loadError
                  }
                  onClick={() => {
                    void exportRecords("orders");
                  }}
                >
                  <ArrowDownToLine size={16} />
                  Export orders
                </button>
              ) : section === "reports" ? (
                <button
                  className="button primary"
                  disabled={
                    loading || exporting || reportPending || !!loadError
                  }
                  onClick={exportReport}
                >
                  <ArrowDownToLine size={16} />
                  Export report
                </button>
              ) : null}
            </div>
          </div>

          {loadError && (
            <div className="pagination-error" role="alert">
              {loadError}
              <button
                className="text-link"
                onClick={() => void snapshot.refetch()}
              >
                Retry loading
              </button>
            </div>
          )}
          {loading && (
            <p className="pagination-loading" role="status">
              Updating records…
            </p>
          )}
          {section === "overview" && (
            <>
              {role === "hq" && (
                <section
                  className={`hq-hold-priority ${summary.held ? "has-holds" : ""}`}
                  aria-label="Orders requiring HQ attention"
                >
                  <div className="hq-hold-priority-heading">
                    <span className="hold-priority-icon">
                      <AlertTriangle size={26} />
                    </span>
                    <div>
                      <h2>
                        {summary.held
                          ? `${summary.held} ${summary.held === 1 ? "order needs" : "orders need"} your attention`
                          : "No orders on hold"}
                      </h2>
                      <p>
                        {summary.held
                          ? "Resolve delivery holds first to keep your shops supplied."
                          : "Delivery holds will appear here as soon as they need your help."}
                      </p>
                    </div>
                    {summary.held > 0 && (
                      <button
                        className="button hold-review-button"
                        onClick={() => {
                          setStatusFilter("On hold");
                          document
                            .getElementById("recent-orders")
                            ?.scrollIntoView({ block: "start" });
                        }}
                      >
                        Review held orders
                        <ArrowRight size={17} />
                      </button>
                    )}
                  </div>
                  {held.length > 0 && (
                    <div className="hq-hold-priority-list">
                      {held.slice(0, 3).map((o) => (
                        <button key={o.id} onClick={() => setSelected(o)}>
                          <div>
                            <strong>{o.business}</strong>
                            <small>{o.reference}</small>
                            <p>
                              {o.workflow?.issue ??
                                "Delivery paused. Review the order and arrange the next step."}
                            </p>
                          </div>
                          <span>
                            Resolve hold
                            <ArrowRight size={16} />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}
              <section className="network-hero">
                <div className="hero-copy">
                  <span className="hero-kicker">
                    <span />
                    Your business, connected
                  </span>
                  <h2>
                    {role === "sme" ? (
                      <>
                        STT shoes.
                        <br />
                        Ready for your shelves.
                      </>
                    ) : role === "driver" ? (
                      <>
                        Every delivery.
                        <br />A business moving forward.
                      </>
                    ) : (
                      <>
                        Every order. Every branch.
                        <br />
                        One connected view.
                      </>
                    )}
                  </h2>
                  <p>
                    {role === "hq"
                      ? "From your warehouse to their shelves, keep your whole network moving forward."
                      : role === "branch"
                        ? "Bring your sales, stock and backup fulfilment together."
                        : role === "driver"
                          ? "Keep the shops that depend on you in the loop."
                          : "STT shoe catalog from the supplier you trust, all in one place."}
                  </p>
                  <Link
                    href={href(
                      role === "hq"
                        ? "orders"
                        : role === "sme"
                          ? "catalog"
                          : role === "branch"
                            ? "inventory"
                            : "deliveries",
                    )}
                    className="hero-link"
                  >
                    {role === "sme"
                      ? "Browse the catalog"
                      : role === "branch"
                        ? "Check your stock"
                        : role === "driver"
                          ? "View assigned deliveries"
                          : "Manage your orders"}
                    <ArrowRight size={16} />
                  </Link>
                </div>
                <NetworkArt />
                <div className="hero-bottom-label">
                  <span />
                  Made for local business
                </div>
              </section>
              <div className="stats-grid">
                {(role === "hq"
                  ? [
                      {
                        label: "Merchandise sales",
                        value: money(summary.wholesale + retail, true),
                        unit: "MMK",
                        note: "Retail + completed wholesale",
                        icon: Wallet,
                        detail: "Recorded history",
                      },
                      {
                        label: "Wholesale orders",
                        value: String(summary.orders),
                        unit: "orders",
                        note: `${summary.active} orders in progress`,
                        icon: ClipboardList,
                        detail: "All statuses",
                      },
                      {
                        label: "Active branches",
                        value: String(
                          data.branches.filter((b) => b.active !== false)
                            .length,
                        ).padStart(2, "0"),
                        unit: "branches",
                        note: "Working together across Yangon",
                        icon: Store,
                        detail: "Your network",
                      },
                      {
                        label: "Needs attention",
                        value: String(summary.awaiting + summary.held).padStart(
                          2,
                          "0",
                        ),
                        unit: "items",
                        note: `${summary.awaiting} payment review · ${summary.held} delivery hold`,
                        icon: Clock3,
                        detail: "Action required",
                      },
                    ]
                  : role === "sme"
                    ? [
                        {
                          label: "Your orders",
                          value: String(summary.orders),
                          unit: "orders",
                          note: "All your wholesale orders",
                          icon: ClipboardList,
                          detail: "Order history",
                        },
                        {
                          label: "In progress",
                          value: String(summary.active),
                          unit: "orders",
                          note: "Follow the latest status",
                          icon: Truck,
                          detail: "Fulfilment",
                        },
                        {
                          label: "Completed purchases",
                          value: money(summary.wholesale, true),
                          unit: "MMK",
                          note: "Merchandise, excluding shipping",
                          icon: ShoppingBag,
                          detail: "Completed",
                        },
                        {
                          label: "Shoe models",
                          value: String(
                            new Set(data.products.map((p) => p.name)).size,
                          ),
                          unit: "model",
                          note: "STT · stocked by size and color",
                          icon: Package,
                          detail: "In the catalog",
                        },
                      ]
                    : role === "branch"
                      ? [
                          {
                            label: "Retail sales",
                            value: money(retail),
                            unit: "MMK",
                            note: "Recorded merchandise sales",
                            icon: Wallet,
                            detail: "Recorded history",
                          },
                          {
                            label: "Transactions",
                            value: String(summary.retailCount),
                            unit: "sales",
                            note: "Posted retail transactions",
                            icon: ShoppingBag,
                            detail: "Sales history",
                          },
                          {
                            label: "Available stock",
                            value: String(
                              data.products.reduce(
                                (s, p) => s + p.stock - p.reserve,
                                0,
                              ),
                            ),
                            unit: "pairs",
                            note: "Excludes protected reserves",
                            icon: Package,
                            detail: "Retail stock",
                          },
                          {
                            label: "Low stock",
                            value: String(
                              data.products.filter(
                                (p) => p.stock - p.reserve < 10,
                              ).length,
                            ),
                            unit: "products",
                            note: "Check your replenishment needs",
                            icon: Clock3,
                            detail: "Inventory",
                          },
                        ]
                      : [
                          {
                            label: "Assigned deliveries",
                            value: String(summary.orders),
                            unit: "jobs",
                            note: "Only jobs assigned to you",
                            icon: Truck,
                            detail: "Your route",
                          },
                          {
                            label: "In transit",
                            value: String(summary.shipping),
                            unit: "jobs",
                            note: "Dispatched deliveries",
                            icon: Package,
                            detail: "On the road",
                          },
                        ]
                ).map((s) => (
                  <section className="stat-card" key={s.label}>
                    <div className="stat-top">
                      <span>{s.label}</span>
                      <Icon icon={s.icon} size={19} />
                    </div>
                    <div className="stat-value">
                      {s.value}
                      <small>{s.unit}</small>
                    </div>
                    <div className="stat-bottom">
                      <span className="stat-indicator" />
                      {s.note}
                    </div>
                  </section>
                ))}
              </div>
              <div className="dashboard-columns">
                <div className="dashboard-primary">
                  {role === "branch" ? (
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Recent retail sales</h2>
                        <Link className="text-link" href={href("sales")}>
                          View all <ArrowRight size={15} />
                        </Link>
                      </div>
                      <SalesList sales={data.retailSales} />
                    </section>
                  ) : (
                    <section className="panel" id="recent-orders">
                      <div className="panel-heading">
                        <div className="heading-inline">
                          <h2>
                            {role === "driver"
                              ? "Assigned deliveries"
                              : "Recent orders"}
                          </h2>
                          <span className="count-chip">{summary.orders}</span>
                        </div>
                        <Link
                          href={href(
                            role === "driver" ? "deliveries" : "orders",
                          )}
                          className="text-link"
                        >
                          View all orders <ArrowRight size={15} />
                        </Link>
                      </div>
                      {role !== "driver" && (
                        <div className="table-tabs">
                          <button
                            className={
                              statusFilter === "All orders" ? "selected" : ""
                            }
                            onClick={() => setStatusFilter("All orders")}
                          >
                            All orders
                          </button>
                          <button
                            className={
                              statusFilter === "Awaiting verification"
                                ? "selected"
                                : ""
                            }
                            onClick={() =>
                              setStatusFilter("Awaiting verification")
                            }
                          >
                            Awaiting verification
                            {summary.awaiting > 0 && (
                              <span>{summary.awaiting}</span>
                            )}
                          </button>
                          <button
                            className={
                              statusFilter === "On hold" ? "selected" : ""
                            }
                            onClick={() => setStatusFilter("On hold")}
                          >
                            On hold
                            {summary.held > 0 && <span>{summary.held}</span>}
                          </button>
                          <button
                            className={
                              statusFilter === "Shipping" ? "selected" : ""
                            }
                            onClick={() => setStatusFilter("Shipping")}
                          >
                            Shipping
                          </button>
                        </div>
                      )}
                      {role === "driver" ? (
                        <div className="driver-job-list">
                          {data.orders.map((o) => (
                            <button
                              className="driver-job-row"
                              key={o.id}
                              onClick={() => setSelected(o)}
                            >
                              <span className="branch-icon">
                                <Truck size={21} />
                              </span>
                              <span>
                                <strong>{o.business}</strong>
                                <small>
                                  {o.location} · {o.items} pairs
                                </small>
                              </span>
                              <Badge status={o.status} />
                              <ChevronRight size={17} />
                            </button>
                          ))}
                        </div>
                      ) : (
                        orderTable(5)
                      )}
                      <div className="table-footer">
                        <span>
                          Showing {Math.min(matchedOrders.length, 5)} of{" "}
                          {data.pagination?.orders.total ??
                            matchedOrders.length}{" "}
                          orders
                        </span>
                        <span>
                          {role === "driver"
                            ? "Your assigned deliveries"
                            : "Amounts include shipping"}
                        </span>
                      </div>
                    </section>
                  )}
                  <section className="network-bottom">
                    <span className="round-icon">
                      <Icon icon={ShieldCheck} size={23} />
                    </span>
                    <div>
                      <strong>A clear path from order to delivery.</strong>
                      <p>
                        Full payment verification. Protected stock. Confirmation
                        from both sides.
                      </p>
                    </div>
                    <Link
                      href={href("help")}
                      aria-label="Read the order workflow"
                      className="icon-button"
                      onClick={
                        role === "hq" || role === "branch"
                          ? (e) => {
                              e.preventDefault();
                              open("help");
                            }
                          : undefined
                      }
                    >
                      <ArrowUpRight size={20} />
                    </Link>
                  </section>
                </div>
                <div className="dashboard-rail">
                  {role === "hq" || role === "sme" ? (
                    branchPanel
                  ) : (
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>
                          {role === "driver"
                            ? "Before you set off"
                            : "Protected wholesale reserve"}
                        </h2>
                      </div>
                      <div className="info-pad">
                        <Icon icon={ShieldCheck} size={28} />
                        <p>
                          {role === "driver"
                            ? "Confirm pickup when you collect the parcel to begin delivery and live location sharing. Keep Supply Link open, then report handover at the destination."
                            : "Retail availability excludes protected wholesale pairs. Backup deliveries need HQ approval and branch acceptance."}
                        </p>
                      </div>
                    </section>
                  )}
                  <section className="panel attention-panel">
                    <div className="panel-heading">
                      <h2>Your action list</h2>
                      <span className="count-chip">
                        {summary.awaiting + summary.held}
                      </span>
                    </div>
                    {awaiting.map((o) => (
                      <button
                        key={o.id}
                        className="action-row"
                        onClick={() => setSelected(o)}
                      >
                        <span className="action-icon amber">
                          <CreditCard size={19} />
                        </span>
                        <span>
                          <strong>
                            {role === "hq"
                              ? "Review full payment"
                              : "Awaiting HQ payment review"}
                          </strong>
                          <small>{o.business}</small>
                          <span className="action-link">
                            {money(total(o))} MMK <ArrowRight size={13} />
                          </span>
                        </span>
                      </button>
                    ))}
                    {held.map((o) => (
                      <button
                        key={o.id}
                        className="action-row"
                        onClick={() => setSelected(o)}
                      >
                        <span className="action-icon rose">
                          <Truck size={19} />
                        </span>
                        <span>
                          <strong>Resolve delivery hold</strong>
                          <small>{o.reference}</small>
                          <span className="action-link">
                            Review order <ArrowRight size={13} />
                          </span>
                        </span>
                      </button>
                    ))}
                    {summary.awaiting + summary.held > attention.length && (
                      <Link
                        className="text-link info-pad"
                        href={href(
                          role === "driver" || role === "branch"
                            ? "deliveries"
                            : "orders",
                        )}
                      >
                        View remaining action items <ArrowRight size={15} />
                      </Link>
                    )}
                    {summary.awaiting + summary.held === 0 && (
                      <div className="caught-up">
                        <CheckCheck size={27} />
                        <strong>You’re all caught up.</strong>
                        <p>We’ll put the next action here.</p>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </>
          )}

          {section === "orders" && (
            <section className="panel">
              <div className="filter-bar">
                <label className="search-field">
                  <Search size={18} />
                  <span className="sr-only">Search orders</span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search business or order reference…"
                  />
                </label>
                <label className="select-field">
                  <SlidersHorizontal size={16} />
                  <span className="sr-only">Order status</span>
                  <select
                    value={statusFilter}
                    onChange={(e) =>
                      setStatusFilter(
                        e.target.value as NonNullable<WorkspaceQuery["status"]>,
                      )
                    }
                  >
                    {[
                      "All orders",
                      "Draft",
                      "Awaiting verification",
                      "Confirmed",
                      "Preparing",
                      "Shipping",
                      "On hold",
                      "Complete",
                      "Done",
                      "Cancelled",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
              {orderTable()}
              {pageControls("orders", "Orders")}
            </section>
          )}

          {section === "inventory" && role === "branch" && (
            <>
              {(data.refillRequestCount ?? 0) > 0 && (
                <p className="inline-note" role="status">
                  Refill requested automatically from HQ for{" "}
                  {data.refillRequestCount} low-stock alerts. Requests close
                  when the affected pool reaches its threshold. Check incoming
                  refills below.
                </p>
              )}
              <StockTransfers
                data={data}
                viewer={viewer}
                updated={applySnapshot}
                pagination={pageControls("transfers", "Transfers")}
              />
            </>
          )}
          {section === "branches" &&
            role === "hq" &&
            (branchId ? (
              <BranchDetail
                key={branchId}
                data={data}
                viewer={viewer}
                demo={demo}
                branchId={branchId}
                updated={applySnapshot}
              />
            ) : (
              <BranchNetwork data={data} updated={applySnapshot} />
            ))}
          {section === "drivers" && role === "hq" && (
            <DriverManagement data={data} updated={applySnapshot} />
          )}
          {section === "stock-planning" && role === "hq" && (
            <StockPlanning
              data={data}
              openOrder={openOrder}
              initialBranchId={planningBranchId}
              viewer={viewer}
              demo={demo}
              updated={async () => {
                await snapshot.refetch();
              }}
            />
          )}
          {(section === "catalog" || section === "inventory") && (
            <>
              <div className="catalog-tools">
                <label className="search-field">
                  <Search size={18} />
                  <span className="sr-only">Search products</span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search shoe size or color…"
                  />
                </label>
              </div>
              <div className="supplier-catalog-note">
                <ShieldCheck size={17} />
                <strong>STT exclusive supplier</strong>
                <span>One shoe model · Sizes 38–40 · White & black</span>
              </div>
              {section === "catalog" && data.settings?.shipping == null && (
                <div className="inline-note">
                  HQ must configure shipping and receiving-account instructions
                  before orders can be quoted.
                </div>
              )}
              {role === "hq" && section === "inventory" && (
                <WorkflowAdmin
                  data={data}
                  mode="inventory"
                  updated={applySnapshot}
                />
              )}
              {section === "inventory" ? (
                <section className="panel">
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Product / pair</th>
                          <th>On hand</th>
                          <th>
                            {role === "branch" ? "Allocated" : "Reserved"}
                          </th>
                          {role === "branch" && (
                            <th>Wholesale backup available</th>
                          )}
                          <th>
                            {role === "branch"
                              ? "Retail available"
                              : "Wholesale available"}
                          </th>
                          <th>Wholesale / pair</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matchedProducts.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <strong>{p.name}</strong>
                              <small>{p.pack}</small>
                            </td>
                            <td>{p.stock} pairs</td>
                            <td>
                              {role === "branch"
                                ? (data.branches
                                    .find((b) => b.id === viewer.branchId)
                                    ?.inventory?.find(
                                      (i) => i.productId === p.id,
                                    )?.allocated ?? 0)
                                : p.reserve}{" "}
                              pairs
                            </td>
                            {role === "branch" && (
                              <td>
                                {data.branches
                                  .find((b) => b.id === viewer.branchId)
                                  ?.inventory?.find((i) => i.productId === p.id)
                                  ?.protected ?? 0}{" "}
                                pairs
                              </td>
                            )}
                            <td>
                              <Badge
                                status={
                                  p.stock - p.reserve < 10
                                    ? "Low stock"
                                    : "In stock"
                                }
                              />
                              <small>{p.stock - p.reserve} pairs</small>
                            </td>
                            <td className="amount">{money(p.price)} MMK</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : (
                <SmeCheckout
                  data={data}
                  viewer={viewer}
                  search={search}
                  query={effectiveQuery}
                  updated={applySnapshot}
                  viewOrder={setSelected}
                  demo={demo}
                />
              )}
              {!matchedProducts.length && section === "inventory" && (
                <Empty
                  icon={Package}
                  title="No products found"
                  text="Try another shoe size or color."
                />
              )}
            </>
          )}

          {((section === "branches" && role !== "hq") ||
            section === "locations") && (
            <div className="branch-grid">
              {data.branches
                .filter((b) => b.active !== false)
                .map((b) => (
                  <section key={b.id} className="panel location-card">
                    <div className="location-art">
                      <Store size={48} strokeWidth={1.2} />
                      <span>SupplyLink local</span>
                    </div>
                    <div className="location-content">
                      <div className="heading-inline">
                        <h2>{b.name}</h2>
                        {demo && (
                          <Badge
                            status={b.lowStock ? "Low stock" : "Healthy"}
                          />
                        )}
                      </div>
                      <p>
                        <MapPin size={16} />
                        {b.pin ? (
                          <LocationLink pin={b.pin} label="View location pin" />
                        ) : (
                          b.address
                        )}
                      </p>
                      <p>
                        <Users size={16} />
                        Managed by {b.manager || "Branch team"}
                      </p>
                      {role === "hq" && (
                        <div className="location-stats">
                          <span>
                            <small>Retail sales</small>
                            <strong>
                              {money(b.sales)} <em>MMK</em>
                            </strong>
                          </span>
                          <span>
                            <small>Stock on hand</small>
                            <strong>
                              {b.stock} <em>pairs</em>
                            </strong>
                          </span>
                        </div>
                      )}
                    </div>
                  </section>
                ))}
            </div>
          )}

          {section === "accounts" && (
            <section className="panel">
              {demo && !viewer.authenticated && (
                <div className="hq-signin-note">
                  <span>
                    Sign in to HQ before issuing SME or driver credentials.
                  </span>
                  <Link className="button primary" href="/hq/login">
                    HQ sign in
                  </Link>
                </div>
              )}
              <div className="filter-bar">
                <label className="search-field">
                  <Search size={18} />
                  <span className="sr-only">Search accounts</span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name or account ID…"
                  />
                </label>
                <span className="muted">{data.accounts.length} accounts</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Account ID</th>
                      <th>Role</th>
                      <th>Location / affiliation</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.accounts
                      .filter((a) =>
                        `${a.name} ${a.username}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((a) => (
                        <tr key={a.id}>
                          <td>
                            <span className="business-cell">
                              <span className="avatar">
                                {a.name
                                  .split(" ")
                                  .slice(0, 2)
                                  .map((s) => s[0])
                                  .join("")}
                              </span>
                              <strong>{a.name}</strong>
                            </span>
                          </td>
                          <td>
                            <code className="account-id">{a.username}</code>
                          </td>
                          <td>
                            {a.role === "sme"
                              ? "SME"
                              : a.role === "hq"
                                ? "Headquarters"
                                : a.role === "driver"
                                  ? "Driver"
                                  : "Branch staff"}
                          </td>
                          <td>
                            {a.role === "sme" && a.pin
                              ? "Map location"
                              : a.affiliation}
                            {a.pin && (
                              <LocationLink
                                pin={a.pin}
                                label="View location pin"
                              />
                            )}
                          </td>
                          <td>
                            <Badge status={a.status} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="inline-note">
                <ShieldCheck size={18} />
                Only headquarters can create SME and driver accounts. New live
                accounts change their temporary password before entering a
                portal.
              </div>
            </section>
          )}

          {section === "reports" && (
            <>
              <section className="panel report-filters" aria-busy={loading}>
                <button
                  className="button secondary"
                  disabled={loading || reportPending}
                  onClick={refreshReport}
                >
                  Refresh report
                </button>
                <label>
                  From
                  <input
                    type="date"
                    value={reportFrom}
                    onChange={(e) => setReportFrom(e.target.value)}
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    value={reportTo}
                    min={reportFrom}
                    onChange={(e) => setReportTo(e.target.value)}
                  />
                </label>
                <label>
                  Sales channel
                  <select
                    value={reportChannel}
                    onChange={(e) =>
                      setReportChannel(
                        e.target.value as NonNullable<
                          WorkspaceQuery["reportChannel"]
                        >,
                      )
                    }
                  >
                    {(role === "branch"
                      ? ["Retail"]
                      : ["All channels", "Wholesale", "Retail"]
                    ).map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <span className="timezone-note">
                  <Clock3 size={16} />
                  Business time: Yangon
                </span>
              </section>
              <div className="stats-grid report-stats">
                {[
                  {
                    label: "Net merchandise sales",
                    value: reportWholesale + reportRetail,
                  },
                  { label: "Wholesale · Done orders", value: reportWholesale },
                  { label: "Retail · posted sales", value: reportRetail },
                ].map((s) => (
                  <section className="stat-card" key={s.label}>
                    <div className="stat-top">
                      {s.label}
                      <Wallet size={18} />
                    </div>
                    <div className="stat-value">
                      {money(s.value, true)}
                      <small>MMK</small>
                    </div>
                    <span className="muted">
                      Excludes shipping and payments
                    </span>
                  </section>
                ))}
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Where your sales come from</h2>
                  <span className="muted">Selected period</span>
                </div>
                <div className="sales-comparison">
                  {[
                    { name: "Wholesale", value: reportWholesale },
                    { name: "Retail", value: reportRetail },
                  ].map((s, i) => (
                    <div className="bar-row" key={s.name}>
                      <strong>{s.name}</strong>
                      <div className="bar-track">
                        <div
                          className={i ? "retail-bar" : "wholesale-bar"}
                          style={{
                            width: `${reportWholesale + reportRetail ? (s.value / (reportWholesale + reportRetail)) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <span>{money(s.value)} MMK</span>
                    </div>
                  ))}
                </div>
                <div className="inline-note">
                  <ShieldCheck size={18} />
                  Wholesale is counted once at Done. Payments and branch backup
                  dispatches do not add a second sale.
                </div>
              </section>
              <section className="panel report-detail">
                <div className="panel-heading">
                  <h2>Underlying sale records</h2>
                  <span className="muted">
                    {data.report?.cutoff
                      ? `As of ${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Yangon", dateStyle: "medium", timeStyle: "short" }).format(new Date(data.report.cutoff))} · Yangon`
                      : "Same records as the export"}
                  </span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Reference</th>
                        <th>Channel</th>
                        <th>Date</th>
                        <th>Net merchandise</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportEvents.map((e) => (
                        <tr key={e.id}>
                          <td>
                            {e.orderId ? (
                              <button
                                className="text-link"
                                onClick={() => void openOrder(e.orderId!)}
                              >
                                {e.reference}
                              </button>
                            ) : (
                              e.reference
                            )}
                          </td>
                          <td>{e.channel}</td>
                          <td>{e.date}</td>
                          <td>{money(e.amount)} MMK</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3}>Total</td>
                        <td>{money(reportWholesale + reportRetail)} MMK</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {pageControls("report", "Sales records")}
                {(data.pagination?.report.total ?? 0) === 0 && (
                  <Empty
                    icon={Wallet}
                    title="No sales in this period"
                    text="Select another date range to see recorded merchandise sales."
                  />
                )}
              </section>
            </>
          )}

          {section === "sales" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Posted retail sales</h2>
                <button className="button primary" onClick={() => open("sale")}>
                  <Plus size={16} />
                  Record a sale
                </button>
              </div>
              <SalesList sales={data.retailSales} />
              {pageControls("retail", "Sales")}
              <div className="inline-note">
                Protected wholesale reserves are excluded from retail
                availability.
              </div>
            </section>
          )}
          {section === "deliveries" && (
            <div className="delivery-grid">
              {data.orders.map((o) => (
                <section className="panel delivery-card" key={o.id}>
                  <div className="heading-inline">
                    <span className="branch-icon">
                      <Truck size={24} />
                    </span>
                    <Badge status={o.status} />
                  </div>
                  <h2>{o.business}</h2>
                  <p className="muted">
                    {o.reference} · {o.items} pairs
                  </p>
                  <div className="delivery-stops">
                    <div>
                      <span className="stop-dot" />
                      <span>
                        <small>Collect from</small>
                        <strong>{o.source}</strong>
                      </span>
                    </div>
                    <div>
                      <MapPin size={18} />
                      <span>
                        <small>Deliver to</small>
                        <strong>{o.location}</strong>
                      </span>
                    </div>
                  </div>
                  {role === "driver" && (
                    <p className="inline-note">
                      {o.workflow?.pickedUpAt
                        ? "Pickup confirmed. Open delivery details, then Open delivery view to follow the route or resume location sharing."
                        : "Open delivery details and confirm pickup after collecting the parcel."}
                    </p>
                  )}
                  <button
                    className="button secondary full-width"
                    onClick={() => setSelected(o)}
                  >
                    View delivery details
                    <ArrowRight size={15} />
                  </button>
                </section>
              ))}
              {pageControls("orders", "Deliveries")}
              {!data.orders.length && (
                <Empty
                  icon={Truck}
                  title="No assigned deliveries"
                  text={
                    demo
                      ? "Your next assigned delivery will appear here."
                      : "HQ assigns deliveries here after payment and stock confirmation."
                  }
                />
              )}
            </div>
          )}
          {section === "help" && <Guide />}
          {section === "settings" && (
            <div className="settings-grid">
              {role === "hq" && (
                <WorkflowAdmin
                  data={data}
                  mode="settings"
                  updated={applySnapshot}
                />
              )}
              <section className="panel">
                <div className="panel-heading">
                  <h2>Your account</h2>
                  <ShieldCheck size={20} />
                </div>
                <dl className="detail-list">
                  <div>
                    <dt>Name</dt>
                    <dd>{viewer.name}</dd>
                  </div>
                  <div>
                    <dt>Portal</dt>
                    <dd>{roleNames[role]}</dd>
                  </div>
                  <div>
                    <dt>Business timezone</dt>
                    <dd>Asia/Yangon</dd>
                  </div>
                  <div>
                    <dt>Currency</dt>
                    <dd>Myanmar kyat (MMK)</dd>
                  </div>
                  <div>
                    <dt>Connection</dt>
                    <dd>
                      <Badge status={demo ? "Demo mode" : "Connected"} />
                    </dd>
                  </div>
                </dl>
                {(viewer.authenticated || !demo) && (
                  <form
                    action={signOut}
                    onSubmit={() => queryClient.clear()}
                    className="info-pad"
                  >
                    <button className="button secondary">
                      <LogOut size={16} />
                      Sign out
                    </button>
                  </form>
                )}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>{demo ? "Portal sign-in pages" : "Workspace access"}</h2>
                </div>
                <div className="info-pad">
                  {demo ? (
                    <>
                      <p>
                        Each portal uses its own sign-in page. Accounts and
                        roles are issued by HQ; signing in determines your
                        workspace.
                      </p>
                      <div className="portal-access-links">
                        <Link href="/sme/login">SME sign in</Link>
                        <Link href="/driver/login">Driver sign in</Link>
                        <Link href="/hq/login">HQ sign in</Link>
                      </div>
                      <p className="muted">
                        Orders and stock persist in the local demo database.
                        Demo login credentials reset when this server restarts.
                      </p>
                    </>
                  ) : (
                    <p>
                      Your portal is assigned by headquarters. Contact HQ to
                      update your role, affiliation or account access.
                    </p>
                  )}
                </div>
              </section>
            </div>
          )}
          <footer className="workspace-footer">
            <span>
              <span className="footer-logo">
                <Boxes size={14} />
              </span>
              STT shoes. Stronger connections.
            </span>
            <span>
              {demo ? "Local demo · Saved workflow" : "SupplyLink workspace"}
              <span className="footer-dot" />
              Yangon, Myanmar
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {modal === "account" && (
        <Modal
          title="Issue a portal login"
          close={() => setModal(null)}
          className="account-modal"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createAccount(new FormData(e.currentTarget));
            }}
            className="modal-form account-form"
          >
            <p className="muted">
              Issue a login account and temporary password. The user changes it
              before entering their portal.{" "}
              {demo && "Demo credentials work until this server restarts."}
            </p>
            <div className="account-details">
              <label className="field">
                Full name or business name
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="e.g. Mingalar Shoe Store"
                />
              </label>
              <label className="field">
                Role
                <select
                  name="role"
                  value={accountRole}
                  onChange={(e) =>
                    setAccountRole(e.target.value as typeof accountRole)
                  }
                >
                  <option value="sme">SME business</option>
                  <option value="driver">Delivery driver</option>
                  <option value="branch">Branch staff</option>
                </select>
              </label>
              <PhoneField />
              {accountRole !== "sme" && (
                <label className="field">
                  {accountRole === "branch"
                    ? "Branch for this staff account"
                    : "Driver assigned location"}
                  <select name="branchId" required={accountRole === "branch"}>
                    <option value="">
                      {accountRole === "branch"
                        ? "Choose an open branch"
                        : "STT Yangon HQ"}
                    </option>
                    {data.branches
                      .filter((b) => b.active !== false)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                  </select>
                  <small>
                    {accountRole === "branch"
                      ? "This login can access only the selected branch."
                      : "HQ drivers serve HQ; branch drivers serve their assigned location."}
                  </small>
                </label>
              )}
            </div>
            <div className="account-location">
              <LocationPicker required label="Account location pin" />
            </div>
            <div className="inline-note">
              The system generates a secure temporary password. It appears once
              with the account ID after creation.
            </div>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={pending}>
                {pending ? "Creating account…" : "Create account & issue login"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {issuedCredentials && (
        <Modal
          title="Account ready to hand over"
          close={() => setIssuedCredentials(null)}
        >
          <div className="credential-ready">
            <p>
              Share these credentials directly with the intended{" "}
              {issuedCredentials.role === "sme"
                ? "business customer"
                : issuedCredentials.role === "branch"
                  ? "branch staff member"
                  : "driver"}
              . They must change the temporary password on first sign-in.
            </p>
            <dl className="detail-list">
              <div>
                <dt>Portal</dt>
                <dd>
                  {issuedCredentials.role === "sme"
                    ? "SME portal"
                    : issuedCredentials.role === "branch"
                      ? "Branch portal"
                      : "Driver portal"}
                </dd>
              </div>
              <div>
                <dt>Sign-in page</dt>
                <dd>{portalLogin(issuedCredentials.role)}</dd>
              </div>
              <div>
                <dt>Account ID</dt>
                <dd>
                  <code>{issuedCredentials.username}</code>
                  <button
                    type="button"
                    className="text-link copy-account-id"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          issuedCredentials.username,
                        );
                        setToast("Account ID copied.");
                      } catch {
                        setToast("Select and copy the account ID above.");
                      }
                    }}
                  >
                    Copy account ID
                  </button>
                </dd>
              </div>
              <div>
                <dt>Temporary password</dt>
                <dd>
                  <code>{issuedCredentials.password}</code>
                </dd>
              </div>
            </dl>
            <p>
              This password is shown only for this handoff. It is not saved in
              the account directory or browser storage.
            </p>
            {demo && (
              <div className="inline-note">
                Local demo account. It resets when the server restarts.
              </div>
            )}
            <button
              className="button primary"
              onClick={() => setIssuedCredentials(null)}
            >
              Done
            </button>
          </div>
        </Modal>
      )}
      {selected && (
        <Modal
          title={selected.reference}
          close={() => {
            setSelected(null);
            if (restoreOrderId)
              router.replace(workspaceHref(role, section, demo), {
                scroll: false,
              });
          }}
        >
          <OrderWorkflow
            paymentInstructions={data.settings?.instructions}
            key={selected.id}
            order={selected}
            viewer={viewer}
            demo={demo}
            deliveryOrigin={section === "overview" ? "overview" : "deliveries"}
            accounts={data.accounts}
            branches={data.branches}
            query={{ ...query, orderId: selected.id }}
            refresh={() => snapshot.refetch({ throwOnError: true })}
            updated={applySnapshot}
            onReceiptConfirmed={(message) => {
              setSelected(null);
              setToast(message);
            }}
          />
        </Modal>
      )}
      {modal === "notifications" && (
        <Modal title="Your notifications" close={() => setModal(null)}>
          <div className="modal-form">
            {refillRequests.map((request) => (
              <Link
                key={request.id}
                className="notification-row"
                href={`/branches/${request.branchId}`}
                onClick={() => setModal(null)}
              >
                <span className="action-icon amber">
                  <Package size={20} />
                </span>
                <span>
                  <strong>
                    {request.pool === "backup"
                      ? "Wholesale backup refill requested"
                      : "Automatic refill requested"}
                  </strong>
                  <small>
                    {request.branchName} · {request.variant}
                  </small>
                  <small>
                    {request.onHand} pairs{" "}
                    {request.pool === "backup" ? "in backup" : "on hand"} ·
                    below {request.threshold}
                  </small>
                  {request.incoming > 0 && (
                    <small>{request.incoming} pairs in pending refills</small>
                  )}
                </span>
                <ChevronRight size={18} />
              </Link>
            ))}
            {refillRequestCount > refillRequests.length && (
              <p>
                Showing the latest {refillRequests.length} of{" "}
                {refillRequestCount} refill requests. Open a branch to review
                its requests.
              </p>
            )}
            {[...awaiting, ...held].map((o) => (
              <button
                key={o.id}
                className="notification-row"
                onClick={() => {
                  setModal(null);
                  setSelected(o);
                }}
              >
                <span className="action-icon amber">
                  <Clock3 size={20} />
                </span>
                <span>
                  <strong>
                    {o.status === "On hold"
                      ? "Delivery needs attention"
                      : "Payment awaiting review"}
                  </strong>
                  <small>
                    {o.business} · {o.reference}
                  </small>
                </span>
                <ChevronRight size={18} />
              </button>
            ))}
            {summary.awaiting + summary.held > attention.length && (
              <p>
                Showing the latest action items. Open orders or deliveries to
                review the rest.
              </p>
            )}
            {notificationCount === 0 && (
              <Empty
                icon={Bell}
                title="You’re all caught up"
                text="New action items will appear here."
              />
            )}
          </div>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="Working together on SupplyLink"
          close={() => setModal(null)}
        >
          <div className="modal-form">
            <Guide />
          </div>
        </Modal>
      )}
      {modal === "sale" && (
        <Modal title="Record a retail sale" close={() => setModal(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createSale(new FormData(e.currentTarget));
            }}
            className="modal-form"
          >
            <p className="muted">
              Post the actual merchandise sale and reduce available branch stock
              in one transaction.
            </p>
            <label className="field">
              Product
              <select name="product">
                {data.products.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.pack} · {p.stock - p.reserve} retail pairs available
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label className="field">
                Pairs sold
                <input
                  type="number"
                  name="quantity"
                  min="1"
                  step="1"
                  defaultValue="1"
                  required
                />
              </label>
              <label className="field">
                Selling price / pair (MMK)
                <input
                  type="number"
                  name="price"
                  min="1"
                  step="1"
                  required
                  placeholder="Enter actual price"
                />
              </label>
            </div>
            <div className="inline-note">
              Protected wholesale reserve is never used for a retail sale.
            </div>
            {formError && (
              <p role="alert" className="form-error">
                {formError}
              </p>
            )}
            <button className="button primary full-width" disabled={pending}>
              Record sale
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Empty({
  icon: Component,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <Component size={32} strokeWidth={1.3} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function SalesList({ sales }: { sales: WorkspaceData["retailSales"] }) {
  return (
    <>
      {sales.map((s) => (
        <div className="sale-row" key={s.id}>
          <span className="branch-icon">
            <ShoppingBag size={20} />
          </span>
          <span>
            <strong>{s.description}</strong>
            <small>
              {s.id} · {s.packs} pairs · {s.date}
            </small>
          </span>
          <strong>
            {money(s.amount)} <small>MMK</small>
          </strong>
        </div>
      ))}
      {!sales.length && (
        <Empty
          icon={ShoppingBag}
          title="No posted sales yet"
          text="Record your first retail sale to start the ledger."
        />
      )}
    </>
  );
}
function Guide() {
  return (
    <div className="guide">
      <div>
        <span className="guide-icon">
          <Users size={23} />
        </span>
        <h3>Accounts come from headquarters</h3>
        <p>
          HQ issues SME and driver account IDs and temporary passwords. Live
          users change that password on first sign-in.
        </p>
      </div>
      <div>
        <span className="guide-icon">
          <CreditCard size={23} />
        </span>
        <h3>Full payment, verified first</h3>
        <p>
          The entire order total, including shipping, is due upfront. A
          screenshot remains evidence until HQ verifies the actual transfer.
        </p>
      </div>
      <div>
        <span className="guide-icon">
          <ShieldCheck size={23} />
        </span>
        <h3>Stock stays accounted for</h3>
        <p>
          Branch retail stock excludes protected wholesale reserves. A backup
          delivery fulfils the original order and creates no extra retail sale.
        </p>
      </div>
      <div>
        <span className="guide-icon">
          <CheckCheck size={23} />
        </span>
        <h3>Completion takes both sides</h3>
        <p>
          HQ completes fulfilment and the SME confirms receipt. Done requires
          both confirmations and no unresolved issue.
        </p>
      </div>
    </div>
  );
}
