"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { money, total, type Order } from "@/lib/domain";
import { statusToneClass } from "@/lib/status-tone";

function PaymentStatus({ order }: { order: Order }) {
  const workflow = order.workflow;
  const latest = workflow?.evidence.reduce<
    NonNullable<Order["workflow"]>["evidence"][number] | undefined
  >(
    (current, proof) =>
      !current || proof.version > current.version ? proof : current,
    undefined,
  );
  const label = workflow?.paymentVerified
    ? "Verified"
    : latest?.status === "pending"
      ? "Awaiting verification"
      : latest?.status === "rejected"
        ? "Rejected"
        : "Not submitted";
  return (
    <span
      className={`sme-payment-status ${statusToneClass(label)}${workflow?.paymentVerified ? " verified" : ""}`}
    >
      {label}
    </span>
  );
}

function ReceivedOn({ order }: { order: Order }) {
  if (!order.workflow?.received) return <>Not yet</>;
  const received = order.workflow.events.find(
    (event) => event.action === "receive",
  );
  if (!received || !Number.isFinite(Date.parse(received.at)))
    return <>Received · time unavailable</>;
  return (
    <time dateTime={received.at}>
      {new Date(received.at).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Yangon",
      })}
    </time>
  );
}

export function SmeOrdersTable({
  orders,
  openOrder,
}: {
  orders: Order[];
  openOrder: (order: Order) => void;
}) {
  const [itemsOrder, setItemsOrder] = useState<Order | null>(null);
  return (
    <>
      <div className="table-scroll">
        <table className="orders-table sme-orders-table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Order items</th>
              <th>Order value</th>
              <th>Order status</th>
              <th>Payment status</th>
              <th>Placed on</th>
              <th>Received on</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => openOrder(order)}
                    aria-label={`View order ${order.reference}`}
                  >
                    {order.reference}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => setItemsOrder(order)}
                    aria-label={`View ${order.items} ordered pairs for ${order.reference}`}
                  >
                    {order.items} pairs
                  </button>
                </td>
                <td className="amount">
                  {money(total(order))}
                  <small>MMK</small>
                </td>
                <td>
                  <span
                    className={`badge badge-${order.status.toLowerCase().replaceAll(" ", "-")} ${statusToneClass(order.status)}`}
                  >
                    <span className="status-dot" />
                    {order.status}
                  </span>
                  {order.workflow?.fulfilment?.current && (
                    <small>
                      Phase {order.workflow.fulfilment.current.number} ·{" "}
                      {order.workflow.fulfilment.current.state === "requested"
                        ? "Awaiting branch acceptance"
                        : order.workflow.fulfilment.deliveryStatus}
                    </small>
                  )}
                </td>
                <td>
                  <PaymentStatus order={order} />
                </td>
                <td>
                  <time dateTime={order.date}>
                    {new Date(`${order.date}T00:00:00Z`).toLocaleDateString(
                      "en-GB",
                      {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        timeZone: "UTC",
                      },
                    )}
                  </time>
                </td>
                <td>
                  <ReceivedOn order={order} />
                </td>
              </tr>
            ))}
            {!orders.length && (
              <tr>
                <td colSpan={7}>No orders match this selection.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted sme-orders-timezone">
        Receipt times are shown in Yangon time.
      </p>
      {itemsOrder && (
        <OrderItems order={itemsOrder} close={() => setItemsOrder(null)} />
      )}
    </>
  );
}

function OrderItems({ order, close }: { order: Order; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal order-items-modal"
      aria-labelledby={titleId}
      onCancel={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal-header">
        <h2 id={titleId}>Order items · {order.reference}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close order items"
          onClick={close}
        >
          <X size={19} />
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Product name</th>
              <th>Unit</th>
            </tr>
          </thead>
          <tbody>
            {order.workflow?.lines.map((line) => (
              <tr key={line.productId}>
                <td>
                  <strong>{line.name}</strong>
                  <small>{line.variant}</small>
                </td>
                <td>{line.quantity} pairs</td>
              </tr>
            ))}
            {!order.workflow?.lines.length && (
              <tr>
                <td colSpan={2}>
                  Item details are unavailable. Refresh your orders to try
                  again.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th>Total ordered</th>
              <td>{order.items} pairs</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </dialog>
  );
}
