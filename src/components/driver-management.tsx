"use client";

import { useRef, useState, useTransition } from "react";
import { Search, Truck } from "lucide-react";
import { workflowAction } from "@/app/workflow-actions";
import type { Account, WorkspaceData } from "@/lib/domain";

type Props = {
  data: WorkspaceData;
  updated: (data: WorkspaceData, message?: string) => void | Promise<void>;
};

function assignedLocation(driver: Account, data: WorkspaceData) {
  return driver.branchId
    ? (data.branches.find((branch) => branch.id === driver.branchId)?.name ??
        driver.branchName ??
        driver.affiliation)
    : "STT Yangon HQ";
}

export function DriverManagement({ data, updated }: Props) {
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const drivers = data.accounts.filter((account) => account.role === "driver");
  const selected = drivers.find((driver) => driver.id === selectedId);
  const matches = drivers.filter((driver) => {
    const matchesBranch =
      !branchFilter ||
      (branchFilter === "__hq__"
        ? !driver.branchId
        : driver.branchId === branchFilter);
    return (
      matchesBranch &&
      `${driver.name} ${driver.username} ${assignedLocation(driver, data)}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
    );
  });

  return (
    <div className="driver-management">
      <section className="panel">
        <div className="panel-heading">
          <h2>Driver directory</h2>
          <span className="count-chip">
            {matches.length} {matches.length === 1 ? "driver" : "drivers"}
          </span>
        </div>
        <div className="filter-bar">
          <label className="search-field">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Search drivers</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, account ID or branch…"
            />
          </label>
          <label className="field driver-branch-filter">
            Branch
            <select
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
              aria-label="Filter drivers by branch"
            >
              <option value="">All branches</option>
              <option value="__hq__">STT Yangon HQ</option>
              {data.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                  {branch.active === false ? " (closed)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        {drivers.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Account ID</th>
                  <th>Assigned branch</th>
                  <th>Status</th>
                  <th>Manage</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((driver) => (
                  <tr key={driver.id}>
                    <td>
                      <strong>{driver.name}</strong>
                    </td>
                    <td>
                      <code className="account-id">{driver.username}</code>
                    </td>
                    <td>{assignedLocation(driver, data)}</td>
                    <td>
                      <span className="workflow-status">{driver.status}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button secondary"
                        aria-label={`Manage affiliation for ${driver.name}`}
                        aria-expanded={selectedId === driver.id}
                        aria-controls="driver-affiliation"
                        onClick={() => setSelectedId(driver.id)}
                      >
                        Manage affiliation
                      </button>
                    </td>
                  </tr>
                ))}
                {!matches.length && (
                  <tr>
                    <td colSpan={5}>No drivers match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="driver-empty">
            <Truck size={30} aria-hidden="true" />
            <h3>No drivers yet</h3>
            <p>
              Create a driver account to start managing branch affiliations.
            </p>
          </div>
        )}
      </section>
      {selected && (
        <DriverAffiliation
          key={`${selected.id}:${selected.branchId ?? "hq"}`}
          driver={selected}
          data={data}
          updated={updated}
          close={() => setSelectedId("")}
        />
      )}
    </div>
  );
}

function DriverAffiliation({
  driver,
  data,
  updated,
  close,
}: Props & { driver: Account; close: () => void }) {
  const [branchId, setBranchId] = useState(driver.branchId ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const openBranches = data.branches.filter(
    (branch) => branch.active !== false,
  );
  const closedBranch =
    driver.branchId &&
    !openBranches.some((branch) => branch.id === driver.branchId);

  function submit() {
    const payload = { driverId: driver.id, branchId, reason: reason.trim() };
    const fingerprint = JSON.stringify(payload);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    const key = retry.current.key;
    setError("");
    start(async () => {
      try {
        const result = await workflowAction(
          "driver_affiliation",
          payload,
          key,
          data.query,
        );
        if (result.error) {
          setError(result.error);
          return;
        }
        if (result.data) {
          retry.current = null;
          await updated(result.data, result.result?.message);
          close();
        }
      } catch {
        setError("Connection interrupted. Retry with the same details.");
      }
    });
  }

  return (
    <section
      className="panel"
      id="driver-affiliation"
      aria-label="Driver affiliation"
    >
      <div className="panel-heading">
        <div>
          <h2>Affiliate {driver.name}</h2>
          <p className="muted">
            Currently assigned to {assignedLocation(driver, data)}
          </p>
        </div>
        <button
          type="button"
          className="text-link"
          disabled={pending}
          onClick={close}
        >
          Close
        </button>
      </div>
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="field">
          Assigned branch
          <select
            name="branchId"
            value={branchId}
            disabled={pending}
            onChange={(event) => setBranchId(event.target.value)}
          >
            <option value="">STT Yangon HQ</option>
            {closedBranch && (
              <option value={driver.branchId!} disabled>
                {assignedLocation(driver, data)} (closed)
              </option>
            )}
            {openBranches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Reason
          <input
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={3}
            maxLength={300}
            required
            disabled={pending}
          />
        </label>
        <p className="muted">
          Resolve active delivery assignments before changing a driver’s
          affiliation.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary"
          disabled={
            pending ||
            branchId === (driver.branchId ?? "") ||
            reason.trim().length < 3
          }
        >
          {pending ? "Saving…" : "Update affiliation"}
        </button>
      </form>
    </section>
  );
}
