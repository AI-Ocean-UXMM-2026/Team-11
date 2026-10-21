"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownToLine,
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
  ordersCsv,
  csvCell,
  roleNames,
  type Account,
  type Order,
  type Product,
  type Role,
  type Viewer,
  type WorkspaceData,
} from "@/lib/domain";
import { provisionAccount, signOut } from "@/app/actions";
import { workflowAction, refreshWorkspace } from "@/app/workflow-actions";
import { OrderWorkflow } from "./order-workflow";
import { WorkflowAdmin } from "./workflow-admin";
import { NetworkArt } from "./network-art";
import { ShoeCatalog } from "./shoe-catalog";
import { workspaceHref, portalLogin } from "@/lib/portals";

type Nav = { key: string; label: string; icon: LucideIcon; badge?: string };
const navigations: Record<Role, Nav[]> = {
  hq: [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "orders", label: "Wholesale orders", icon: ClipboardList },
    { key: "inventory", label: "Shoes & stock", icon: Package },
    { key: "branches", label: "Branches", icon: Store },
    { key: "accounts", label: "SMEs & drivers", icon: Users },
    { key: "reports", label: "Reports", icon: Wallet },
  ],
  sme: [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "catalog", label: "STT catalog", icon: ShoppingBag },
    { key: "orders", label: "My orders", icon: ClipboardList },
    { key: "locations", label: "Supplier locations", icon: MapPin },
  ],
  branch: [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
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
  accounts: "SMEs & drivers",
  reports: "Sales & operations",
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
function download(filename: string, content: string) {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8;" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
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
}: {
  data: WorkspaceData;
  viewer: Viewer;
  demo: boolean;
  section: string;
}) {
  const [data, setData] = useState(initialData);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All orders");
  const [issuedCredentials, setIssuedCredentials] = useState<{
    username: string;
    password: string;
    role: "sme" | "driver";
  } | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const [modal, setModal] = useState<
    "account" | "notifications" | "help" | "order" | "sale" | null
  >(null);
  const [selected, setSelected] = useState<Order | null>(null);
  const [toast, setToast] = useState("");
  const [basket, setBasket] = useState<Record<string, number>>({});
  const [formError, setFormError] = useState("");
  const [pending, startTransition] = useTransition();
  const [reportChannel, setReportChannel] = useState(
    viewer.role === "branch" ? "Retail" : "All channels",
  );
  const [reportFrom, setReportFrom] = useState(
    () => businessDate(new Date().toISOString()).slice(0, 7) + "-01",
  );
  const [reportTo, setReportTo] = useState(() =>
    businessDate(new Date().toISOString()),
  );
  const router = useRouter();
  const role = viewer.role;
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
    setData(initialData);
  }, [initialData]);
  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const result = await refreshWorkspace().catch(() => null);
      if (result?.data) applySnapshot(result.data);
    };
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  function update(next: WorkspaceData) {
    setData(next);
  }
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
  const awaiting = data.orders.filter(
    (o) => o.status === "Awaiting verification",
  );
  const held = data.orders.filter((o) => o.status === "On hold");
  const active = data.orders.filter(
    (o) => !["Done", "Cancelled", "Draft"].includes(o.status),
  );
  const retail = data.retailSales.reduce((sum, sale) => sum + sale.amount, 0);
  const matchedOrders = data.orders.filter(
    (o) =>
      `${o.reference} ${o.business} ${o.location}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (statusFilter === "All orders" || o.status === statusFilter),
  );
  const matchedProducts = data.products.filter((p) =>
    `${p.name} ${p.brand} ${p.size} ${p.color}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const cart = data.products
    .filter((p) => basket[p.id])
    .map((p) => ({ ...p, quantity: basket[p.id] }));
  const subtotal = cart.reduce((sum, p) => sum + p.price * p.quantity, 0);
  const reportEvents = (data.salesEvents ?? []).filter(
    (e) =>
      e.date >= reportFrom &&
      e.date <= reportTo &&
      (reportChannel === "All channels" || e.channel === reportChannel),
  );
  const reportWholesale = reportEvents
    .filter((e) => e.channel === "Wholesale")
    .reduce((sum, e) => sum + e.amount, 0);
  const reportRetail = reportEvents
    .filter((e) => e.channel === "Retail")
    .reduce((sum, e) => sum + e.amount, 0);

  function exportReport() {
    if (reportFrom > reportTo) {
      setToast("Choose an end date on or after the start date.");
      return;
    }
    const rows: unknown[][] = [
      [
        "SupplyLink merchandise sales",
        "From",
        reportFrom,
        "To",
        reportTo,
        "Channel",
        reportChannel,
      ],
      ["Reference", "Channel", "Date", "Net merchandise MMK"],
      ...reportEvents.map((e) => [e.reference, e.channel, e.date, e.amount]),
      ["Total", "", "", reportWholesale + reportRetail],
    ];
    download(
      "supplylink-merchandise-sales.csv",
      rows.map((r) => r.map(csvCell).join(",")).join("\r\n"),
    );
    setToast("Report exported with the selected filters.");
  }
  function applySnapshot(next: WorkspaceData, message?: string) {
    setData(next);
    setSelected((previous) =>
      previous ? (next.orders.find((o) => o.id === previous.id) ?? null) : null,
    );
    if (message) setToast(message);
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
        const result = await workflowAction(action, payload, key);
        if (result.error) {
          setFormError(result.error);
          return;
        }
        operationRetry.current = null;
        if (result.data) {
          applySnapshot(result.data, result.result?.message);
          onSuccess?.(result.data, result.result?.orderId);
        }
      } catch {
        setFormError(
          "Connection interrupted. Retry the same details to check the result.",
        );
      }
    });
  }
  function createOrder(form: FormData) {
    mutate(
      "create",
      {
        items: cart.map((p) => ({ productId: p.id, quantity: p.quantity })),
        receiver: String(form.get("receiver") ?? ""),
        phone: String(form.get("phone") ?? ""),
        address: String(form.get("address") ?? ""),
        area: data.settings?.area ?? "Yangon",
        expectedTotal: subtotal + (data.settings?.shipping ?? 0),
      },
      (next, id) => {
        setBasket({});
        setModal(null);
        setSelected(next.orders.find((o) => o.id === id) ?? null);
      },
    );
  }
  function createAccount(form: FormData) {
    const input = {
      name: String(form.get("name") ?? "").trim(),
      username: String(form.get("username") ?? "")
        .trim()
        .toLowerCase(),
      role: String(form.get("role")) as "sme" | "driver",
      password: String(form.get("password") ?? ""),
      phone: String(form.get("phone") ?? ""),
      address: String(form.get("address") ?? ""),
      branchId: String(form.get("branchId") ?? ""),
    };
    startTransition(async () => {
      const result = await provisionAccount(input);
      if (result.error) {
        setFormError(result.error);
        return;
      }
      const account: Account = {
        id: result.id!,
        name: input.name,
        username: input.username,
        role: input.role,
        status: "Active",
        affiliation: input.address,
      };
      update({ ...data, accounts: [account, ...data.accounts] });
      setModal(null);
      setIssuedCredentials({
        username: input.username,
        password: input.password,
        role: input.role,
      });
      router.refresh();
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

  const orderTable = (limit?: number) => (
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
      {data.branches.map((b) => (
        <div className="branch-row" key={b.id}>
          <span className="branch-icon">
            <Icon icon={Store} size={20} />
          </span>
          <div>
            <strong>{b.name}</strong>
            <span>
              {role === "hq"
                ? `${money(data.retailSales.filter((s) => s.branchId === b.id).reduce((s, x) => s + x.amount, 0))} MMK in retail sales`
                : b.address}
            </span>
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
                    ? "Hlaing branch"
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
              {n.key === "orders" && awaiting.length > 0 && (
                <span className="nav-count">{awaiting.length}</span>
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
              {section === "overview" ? "Overview" : sectionTitles[section]}
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
              aria-label={`Notifications, ${awaiting.length + held.length} action items`}
            >
              <Icon icon={Bell} size={20} />
              {awaiting.length + held.length > 0 && <i />}
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
        <main id="main" className="main-content">
          <div className="page-heading">
            <div>
              {section === "overview" ? (
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
                          accounts:
                            "Bring your business customers and delivery team on board.",
                          reports:
                            "Recorded sales, clear numbers. Shipping stays separate.",
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
                  onClick={() => {
                    download("supplylink-orders.csv", ordersCsv(matchedOrders));
                    setToast("Visible orders exported.");
                  }}
                >
                  <ArrowDownToLine size={16} />
                  Export orders
                </button>
              ) : section === "reports" ? (
                <button className="button primary" onClick={exportReport}>
                  <ArrowDownToLine size={16} />
                  Export report
                </button>
              ) : null}
            </div>
          </div>

          {section === "overview" && (
            <>
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
                        value: money(
                          merchandiseSales(data.orders) + retail,
                          true,
                        ),
                        unit: "MMK",
                        note: "Retail + completed wholesale",
                        icon: Wallet,
                        detail: "Recorded history",
                      },
                      {
                        label: "Wholesale orders",
                        value: String(data.orders.length),
                        unit: "orders",
                        note: `${active.length} orders in progress`,
                        icon: ClipboardList,
                        detail: "All statuses",
                      },
                      {
                        label: "Active branches",
                        value: String(data.branches.length).padStart(2, "0"),
                        unit: "branches",
                        note: "Working together across Yangon",
                        icon: Store,
                        detail: "Your network",
                      },
                      {
                        label: "Needs attention",
                        value: String(awaiting.length + held.length).padStart(
                          2,
                          "0",
                        ),
                        unit: "items",
                        note: `${awaiting.length} payment review · ${held.length} delivery hold`,
                        icon: Clock3,
                        detail: "Action required",
                      },
                    ]
                  : role === "sme"
                    ? [
                        {
                          label: "Your orders",
                          value: String(data.orders.length),
                          unit: "orders",
                          note: "All your wholesale orders",
                          icon: ClipboardList,
                          detail: "Order history",
                        },
                        {
                          label: "In progress",
                          value: String(active.length),
                          unit: "orders",
                          note: "Follow the latest status",
                          icon: Truck,
                          detail: "Fulfilment",
                        },
                        {
                          label: "Completed purchases",
                          value: money(merchandiseSales(data.orders), true),
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
                            value: String(data.retailSales.length),
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
                            value: String(data.orders.length),
                            unit: "jobs",
                            note: "Only jobs assigned to you",
                            icon: Truck,
                            detail: "Your route",
                          },
                          {
                            label: "In transit",
                            value: String(
                              data.orders.filter((o) => o.status === "Shipping")
                                .length,
                            ),
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
                    <section className="panel">
                      <div className="panel-heading">
                        <div className="heading-inline">
                          <h2>
                            {role === "driver"
                              ? "Assigned deliveries"
                              : "Recent orders"}
                          </h2>
                          <span className="count-chip">
                            {data.orders.length}
                          </span>
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
                            {awaiting.length > 0 && (
                              <span>{awaiting.length}</span>
                            )}
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
                          {matchedOrders.length} orders
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
                            ? "Review the receiver details before you set off. Report handover here; SME receipt is a separate confirmation. GPS sharing is not connected yet."
                            : "Retail availability excludes protected wholesale pairs. Backup deliveries need HQ approval and branch acceptance."}
                        </p>
                      </div>
                    </section>
                  )}
                  <section className="panel attention-panel">
                    <div className="panel-heading">
                      <h2>Your action list</h2>
                      <span className="count-chip">
                        {awaiting.length + held.length}
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
                    {!awaiting.length && !held.length && (
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
                    onChange={(e) => setStatusFilter(e.target.value)}
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
              <div className="table-footer">
                {matchedOrders.length} matching orders{" "}
              </div>
            </section>
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
                {section === "catalog" && (
                  <button
                    className="button primary"
                    disabled={
                      !cart.length || data.settings?.shipping == null || pending
                    }
                    onClick={() => open("order")}
                  >
                    <ShoppingBag size={17} />
                    Review order ({cart.reduce((s, p) => s + p.quantity, 0)})
                  </button>
                )}
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
                          <th>Protected / allocated</th>
                          <th>Retail available</th>
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
                            <td>{p.reserve} pairs</td>
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
                <ShoeCatalog
                  products={matchedProducts}
                  basket={basket}
                  change={setBasket}
                  demo={demo}
                />
              )}
              {!matchedProducts.length && (
                <Empty
                  icon={Package}
                  title="No products found"
                  text="Try another shoe size or color."
                />
              )}
            </>
          )}

          {(section === "branches" || section === "locations") && (
            <div className="branch-grid">
              {data.branches.map((b) => (
                <section key={b.id} className="panel location-card">
                  <div className="location-art">
                    <Store size={48} strokeWidth={1.2} />
                    <span>SupplyLink local</span>
                  </div>
                  <div className="location-content">
                    <div className="heading-inline">
                      <h2>{b.name}</h2>
                      {demo && (
                        <Badge status={b.lowStock ? "Low stock" : "Healthy"} />
                      )}
                    </div>
                    <p>
                      <MapPin size={16} />
                      {b.address}
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
                            {money(
                              data.retailSales
                                .filter((s) => s.branchId === b.id)
                                .reduce((sum, s) => sum + s.amount, 0),
                            )}{" "}
                            <em>MMK</em>
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
                          <td>{a.username}</td>
                          <td>
                            {a.role === "sme"
                              ? "SME"
                              : a.role === "hq"
                                ? "Headquarters"
                                : a.role === "driver"
                                  ? "Driver"
                                  : "Branch staff"}
                          </td>
                          <td>{a.affiliation}</td>
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
              <section className="panel report-filters">
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
                    onChange={(e) => setReportChannel(e.target.value)}
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
                  <span className="muted">Same records as the export</span>
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
                                onClick={() =>
                                  setSelected(
                                    data.orders.find(
                                      (o) => o.id === e.orderId,
                                    ) ?? null,
                                  )
                                }
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
                {reportWholesale + reportRetail === 0 && (
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
                  <div className="gps-placeholder">
                    <MapPin size={21} />
                    <strong>Location sharing is not connected yet</strong>
                    <p>
                      No live location is being collected. Use manual updates
                      with HQ for this baseline.
                    </p>
                  </div>
                  <button
                    className="button secondary full-width"
                    onClick={() => setSelected(o)}
                  >
                    View delivery details
                    <ArrowRight size={15} />
                  </button>
                </section>
              ))}
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
                  <form action={signOut} className="info-pad">
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
          title="Create an SME or driver account"
          close={() => setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createAccount(new FormData(e.currentTarget));
            }}
            className="modal-form"
          >
            <p className="muted">
              Issue a login account and temporary password. The user changes it
              before entering their portal.{" "}
              {demo && "Demo credentials work until this server restarts."}
            </p>
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
            <div className="form-grid">
              <label className="field">
                Role
                <select name="role">
                  <option value="sme">SME business</option>
                  <option value="driver">Delivery driver</option>
                </select>
              </label>
              <label className="field">
                Account ID
                <input
                  name="username"
                  required
                  pattern="[a-z0-9][a-z0-9._-]{2,39}"
                  placeholder="mingalar.shoes"
                  autoComplete="off"
                />
              </label>
            </div>
            <div className="form-grid">
              <label className="field">
                Contact number
                <input
                  name="phone"
                  type="tel"
                  required
                  minLength={6}
                  maxLength={30}
                  placeholder="09…"
                />
              </label>
              <label className="field">
                Location / address
                <input
                  name="address"
                  required
                  minLength={2}
                  maxLength={300}
                  placeholder="Hlaing, Yangon"
                />
              </label>
            </div>
            {!demo && (
              <label className="field">
                Driver affiliation
                <select name="branchId">
                  <option value="">STT Yangon headquarters</option>
                  {data.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <small>Applies only to driver accounts.</small>
              </label>
            )}
            <label className="field">
              Temporary password
              <input
                name="password"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
              <small>
                At least 12 characters. The credential handoff appears once
                after creation.
              </small>
            </label>
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
                : "driver"}
              . They must change the temporary password on first sign-in.
            </p>
            <dl className="detail-list">
              <div>
                <dt>Portal</dt>
                <dd>
                  {issuedCredentials.role === "sme"
                    ? "SME portal"
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
        <Modal title={selected.reference} close={() => setSelected(null)}>
          <OrderWorkflow
            key={selected.id}
            order={selected}
            viewer={viewer}
            accounts={data.accounts}
            updated={applySnapshot}
          />
        </Modal>
      )}
      {modal === "notifications" && (
        <Modal title="Your notifications" close={() => setModal(null)}>
          <div className="modal-form">
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
            {!awaiting.length && !held.length && (
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
      {modal === "order" && (
        <Modal title="Review your wholesale order" close={() => setModal(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createOrder(new FormData(e.currentTarget));
            }}
            className="modal-form"
          >
            {cart.map((p) => (
              <div className="quote-line" key={p.id}>
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.pack} · {p.quantity} × {money(p.price)} MMK
                  </small>
                </span>
                <strong>{money(p.quantity * p.price)} MMK</strong>
              </div>
            ))}
            <dl className="detail-list">
              <div>
                <dt>Merchandise</dt>
                <dd>{money(subtotal)} MMK</dd>
              </div>
              <div>
                <dt>Yangon shipping quote</dt>
                <dd>
                  {data.settings?.shipping == null
                    ? "Awaiting HQ setup"
                    : `${money(data.settings.shipping)} MMK`}
                </dd>
              </div>
              <div className="total-row">
                <dt>Full total due upfront</dt>
                <dd>{money(subtotal + (data.settings?.shipping ?? 0))} MMK</dd>
              </div>
            </dl>
            <label className="field">
              Receiver name
              <input name="receiver" required defaultValue={viewer.name} />
            </label>
            <label className="field">
              Receiver phone
              <input
                name="phone"
                type="tel"
                minLength={6}
                maxLength={30}
                required
              />
            </label>
            <label className="field">
              Delivery address
              <textarea
                name="address"
                required
                maxLength={300}
                defaultValue="Hlaing, Yangon"
              />
            </label>
            <div className="inline-note">
              Save this quote, then submit full-payment evidence. Stock is
              reserved only after HQ verifies the actual transfer.
            </div>
            {formError && (
              <p role="alert" className="form-error">
                {formError}
              </p>
            )}
            <button className="button primary full-width" disabled={pending}>
              {pending ? "Saving…" : "Save quote & continue"}
            </button>
          </form>
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
