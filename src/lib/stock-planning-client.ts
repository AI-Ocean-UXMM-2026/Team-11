export async function planningRequest(input: Record<string, unknown>) {
  const response = await fetch("/api/stock-planning", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body.error ??
        "Unable to save the stock plan. Retry with the same details.",
    );
  return body.result;
}
