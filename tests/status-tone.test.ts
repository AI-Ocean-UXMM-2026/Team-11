import { expect, it } from "vitest";
import { statusTone } from "../src/lib/status-tone";

it("maps workflow states to clear semantic tones", () => {
  expect(statusTone("Draft")).toBe("neutral");
  expect(statusTone("Awaiting verification")).toBe("warning");
  expect(statusTone("On hold")).toBe("warning");
  expect(statusTone("Shipping")).toBe("info");
  expect(statusTone("In Transit")).toBe("info");
  expect(statusTone("Healthy")).toBe("success");
  expect(statusTone("Done")).toBe("success");
  expect(statusTone("Cancelled")).toBe("danger");
  expect(statusTone("Out of stock")).toBe("danger");
});
