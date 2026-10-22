export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export function statusTone(status: string): StatusTone {
  const value = status.trim().toLowerCase().replaceAll(/[_-]+/g, " ");

  if (
    /cancel|reject|fail|suspend|closed|declined|error|overdue|out of stock/.test(
      value,
    )
  )
    return "danger";
  if (
    /await|pending|low stock|on hold|remaining|needs setup|not configured|warning|attention|review required/.test(
      value,
    )
  )
    return "warning";
  if (
    /done|complete|received|active|healthy|connected|verified|accepted|open|ready|fulfilled|in stock/.test(
      value,
    )
  )
    return "success";
  if (
    /confirm|preparing|shipping|in transit|dispatch|reserved|assigned|processing|live|ai assisted/.test(
      value,
    )
  )
    return "info";
  return "neutral";
}

export function statusToneClass(status: string) {
  return `status-tone-${statusTone(status)}`;
}
