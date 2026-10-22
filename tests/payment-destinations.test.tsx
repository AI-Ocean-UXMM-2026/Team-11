// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PaymentDestinations } from "../src/components/payment-destinations";
import { WorkflowAdmin } from "../src/components/workflow-admin";
import {
  demoPaymentInstructions,
  readPaymentInstructions,
} from "../src/lib/payment-instructions";
import { demoData } from "../src/lib/demo-data";
const action = vi.hoisted(() => vi.fn());
vi.mock("../src/app/workflow-actions", () => ({ workflowAction: action }));
let host: HTMLDivElement, root: Root;
const copy = vi.fn(),
  updated = vi.fn(async () => {});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  copy.mockReset().mockResolvedValue(undefined);
  action.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("shows both receiving accounts, the total and a working copy action", async () => {
  await act(async () =>
    root.render(
      <PaymentDestinations
        instructions={demoPaymentInstructions}
        amount={1891500}
      />,
    ),
  );
  for (const text of [
    "Where to transfer",
    "KPay",
    "WavePay",
    "DEMO-KPAY-001",
    "DEMO-WAVE-002",
    "1,891,500",
  ])
    expect(host.textContent).toContain(text);
  await act(async () => {
    (
      host.querySelector(
        '[aria-label="Copy KPay account number"]',
      ) as HTMLButtonElement
    ).click();
  });
  expect(copy).toHaveBeenCalledWith("DEMO-KPAY-001");
  expect(host.textContent).toContain("Copied");
});
it("shows missing receiving details clearly and avoids asking for another transfer after payment", async () => {
  await act(async () =>
    root.render(
      <PaymentDestinations instructions="Pay using a wallet" amount={1000} />,
    ),
  );
  expect(host.textContent).toContain(
    "HQ has not provided a receiving account number",
  );
  expect(host.querySelector(".receiving-account")).toBeNull();
  await act(async () =>
    root.render(
      <PaymentDestinations
        instructions={demoPaymentInstructions}
        amount={1000}
        paymentConfirmed
      />,
    ),
  );
  expect(host.textContent).not.toContain("Transfer the full quoted total");
  expect(host.textContent).toContain("Order total");
});
it("loads HQ receiving fields and saves them in the existing configuration payload", async () => {
  const data = {
    ...demoData,
    settings: {
      shipping: 1500,
      instructions: demoPaymentInstructions,
      area: "Yangon",
    },
  };
  action.mockResolvedValue({ data });
  await act(async () =>
    root.render(
      <WorkflowAdmin data={data} mode="settings" updated={updated} />,
    ),
  );
  expect(
    (host.querySelector("[name=accountNumber0]") as HTMLInputElement).value,
  ).toBe("DEMO-KPAY-001");
  expect(
    (host.querySelector("[name=accountNumber1]") as HTMLInputElement).value,
  ).toBe("DEMO-WAVE-002");
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(action.mock.calls[0][0]).toBe("configure");
  expect(
    readPaymentInstructions(action.mock.calls[0][1].instructions).accounts,
  ).toHaveLength(2);
});
it("prevents a settings save with notes alone and no receiving account number", async () => {
  const data = {
    ...demoData,
    settings: {
      shipping: 1500,
      instructions: "KPay or WavePay",
      area: "Yangon",
    },
  };
  await act(async () =>
    root.render(
      <WorkflowAdmin data={data} mode="settings" updated={updated} />,
    ),
  );
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(action).not.toHaveBeenCalled();
  expect(host.textContent).toContain(
    "Enter a payment method, account holder and account number",
  );
});
