import { isDemoMode } from "@/lib/supabase/config";
import { workflowActor, WorkflowError } from "@/lib/workflow/server";
import { deliveryTracking } from "@/lib/workflow/tracking";
import { subscribeDemoTracking } from "@/lib/workflow/tracking-events";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!isDemoMode()) return new Response(null, { status: 404 });
    const actor = await workflowActor();
    const { id } = await params;
    await deliveryTracking(actor, id);
    let cleanup = () => {};
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        const write = (value: string) => {
          if (!closed) controller.enqueue(new TextEncoder().encode(value));
        };
        const unsubscribe = subscribeDemoTracking(id, () =>
          write("event: change\ndata: {}\n\n"),
        );
        const heartbeat = setInterval(() => write(": heartbeat\n\n"), 15_000);
        // Bound connections so reconnection revalidates the session and access.
        const lifetime = setTimeout(() => cleanup(), 45_000);
        cleanup = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          clearInterval(heartbeat);
          clearTimeout(lifetime);
          request.signal.removeEventListener("abort", cleanup);
          controller.close();
        };
        request.signal.addEventListener("abort", cleanup, { once: true });
        if (request.signal.aborted) cleanup();
        else write("event: change\ndata: {}\n\n");
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "private, no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return Response.json(
      { error: "Tracking unavailable." },
      { status: error instanceof WorkflowError ? error.status : 403 },
    );
  }
}
