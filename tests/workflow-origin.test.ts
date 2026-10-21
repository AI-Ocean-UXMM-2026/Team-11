import { it, expect } from "vitest";
import { samePortalOrigin } from "../src/lib/workflow/origin";
it("uses the incoming host when the preview server normalizes request URLs", () => {
  expect(
    samePortalOrigin(
      new Request("http://localhost:3000/api/workflow", {
        headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
      }),
    ),
  ).toBe(true);
  for (const origin of [
    "https://evil.example",
    "null",
    "http://127.0.0.1:3001",
  ])
    expect(
      samePortalOrigin(
        new Request("http://localhost:3000/api/workflow", {
          headers: { host: "127.0.0.1:3000", origin },
        }),
      ),
    ).toBe(false);
  expect(
    samePortalOrigin(new Request("http://localhost:3000/api/workflow")),
  ).toBe(false);
});
