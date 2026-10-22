// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DriverManagement } from "../src/components/driver-management";
import { demoData } from "../src/lib/demo-data";
import type { WorkspaceData } from "../src/lib/domain";

const action = vi.hoisted(() => vi.fn());
vi.mock("../src/app/workflow-actions", () => ({ workflowAction: action }));
let host: HTMLDivElement, root: Root, data: WorkspaceData;
const updated = vi.fn(async () => {});

async function click(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      (element.getAttribute("aria-label") ?? element.textContent)?.includes(
        label,
      ),
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}

async function chooseBranch(branchId: string) {
  const select = host.querySelector<HTMLSelectElement>(
    'select[name="branchId"]',
  )!;
  await act(async () => {
    select.value = branchId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const input = host.querySelector<HTMLInputElement>('input[name="reason"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "Cover this location");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  data = {
    ...demoData,
    query: { ordersPage: 2 },
    branches: [
      {
        ...demoData.branches[0],
        id: "branch-open",
        name: "Hlaing branch",
        active: true,
      },
      {
        ...demoData.branches[0],
        id: "branch-closed",
        name: "Closed branch",
        active: false,
      },
    ],
    accounts: [
      {
        id: "driver-hq",
        name: "HQ Driver",
        username: "hq.driver",
        role: "driver",
        status: "Active",
        affiliation: "STT Yangon HQ",
        branchId: null,
      },
      {
        id: "driver-branch",
        name: "Branch Driver",
        username: "branch.driver",
        role: "driver",
        status: "Pending setup",
        affiliation: "Hlaing branch",
        branchId: "branch-open",
      },
      {
        id: "sme",
        name: "Private SME",
        username: "sme",
        role: "sme",
        status: "Active",
        affiliation: "Yangon",
      },
    ],
  };
  action.mockReset();
  updated.mockClear();
  await act(async () =>
    root.render(<DriverManagement data={data} updated={updated} />),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("lists only drivers with their current affiliation and initializes editing to that location", async () => {
  expect(host.textContent).toContain("HQ Driver");
  expect(host.textContent).toContain("STT Yangon HQ");
  expect(host.textContent).toContain("Branch Driver");
  expect(host.textContent).toContain("Hlaing branch");
  expect(host.textContent).not.toContain("Private SME");
  await click("Manage affiliation for Branch Driver");
  expect(
    host.querySelector<HTMLSelectElement>('select[name="branchId"]')!.value,
  ).toBe("branch-open");
  expect(
    [
      ...host.querySelectorAll<HTMLOptionElement>(
        'select[name="branchId"] option',
      ),
    ].some((option) => option.value === "branch-closed"),
  ).toBe(false);
});

it("filters the driver directory by branch", async () => {
  const filter = host.querySelector<HTMLSelectElement>(
    'select[aria-label="Filter drivers by branch"]',
  )!;
  await act(async () => {
    filter.value = "branch-open";
    filter.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.textContent).toContain("Branch Driver");
  expect(host.textContent).toContain("Hlaing branch");
  expect(host.textContent).not.toContain("HQ Driver");
});

it("saves an HQ driver’s branch affiliation and refreshes the workspace", async () => {
  const next = {
    ...data,
    accounts: data.accounts.map((account) =>
      account.id === "driver-hq"
        ? { ...account, branchId: "branch-open" }
        : account,
    ),
  };
  action.mockResolvedValue({
    data: next,
    result: { message: "Driver affiliation updated." },
  });
  await click("Manage affiliation for HQ Driver");
  await chooseBranch("branch-open");
  await click("Update affiliation");
  expect(action).toHaveBeenCalledWith(
    "driver_affiliation",
    {
      driverId: "driver-hq",
      branchId: "branch-open",
      reason: "Cover this location",
    },
    expect.any(String),
    data.query,
  );
  expect(updated).toHaveBeenCalledWith(next, "Driver affiliation updated.");
  expect(host.querySelector("form")).toBeNull();
});

it("supports returning a branch driver to HQ and preserves retry keys after a rejected change", async () => {
  action.mockResolvedValue({
    error: "Resolve active driver assignments before changing affiliation.",
  });
  await click("Manage affiliation for Branch Driver");
  await chooseBranch("");
  await click("Update affiliation");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Resolve active driver assignments",
  );
  expect(updated).not.toHaveBeenCalled();
  await click("Update affiliation");
  expect(action.mock.calls[0][1]).toEqual({
    driverId: "driver-branch",
    branchId: "",
    reason: "Cover this location",
  });
  expect(action.mock.calls[1][2]).toBe(action.mock.calls[0][2]);
});
