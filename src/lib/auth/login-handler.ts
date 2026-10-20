import "server-only";
import { authenticatePortal } from "./login";
import type { LoginPortal } from "../portals";
export function portalLoginHandler(portal: LoginPortal) {
  return async (request: Request) => {
    const headers = { "Cache-Control": "no-store" };
    const origin = request.headers.get("origin");
    const host = request.headers.get("host") ?? new URL(request.url).host;
    let allowed = true;
    try {
      allowed = !origin || new URL(origin).host === host;
    } catch {
      allowed = false;
    }
    if (!allowed)
      return Response.json(
        { error: "Request origin is not allowed." },
        { status: 403, headers },
      );
    if (!request.headers.get("content-type")?.includes("application/json"))
      return Response.json(
        { error: "Send a JSON body with username and password." },
        { status: 415, headers },
      );
    let input: unknown;
    try {
      const text = await request.text();
      if (text.length > 4096)
        return Response.json(
          { error: "Request is too large." },
          { status: 413, headers },
        );
      input = JSON.parse(text);
    } catch {
      return Response.json(
        { error: "Invalid JSON body." },
        { status: 400, headers },
      );
    }
    try {
      const result = await authenticatePortal(portal, input);
      return Response.json(
        result.error
          ? { error: result.error }
          : { redirectTo: result.redirectTo },
        { status: result.status, headers },
      );
    } catch {
      return Response.json(
        { error: "Sign-in is temporarily unavailable. Please try again." },
        { status: 503, headers },
      );
    }
  };
}
