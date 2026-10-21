import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  readEvidence,
  workflowActor,
  WorkflowError,
} from "@/lib/workflow/server";
import { localRoot } from "@/lib/workflow/local";
import { isDemoMode } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; evidenceId: string }> },
) {
  try {
    const actor = await workflowActor();
    const { id, evidenceId } = await params;
    const proof = await readEvidence(actor, id, evidenceId);
    if (!proof.path || !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.png$/.test(proof.path))
      throw new WorkflowError("Evidence unavailable.", 404);
    let bytes: Uint8Array;
    if (isDemoMode())
      bytes = await readFile(
        path.join(localRoot(), "payment-evidence", proof.path),
      );
    else {
      const db = await createClient();
      const { data, error } = await db.storage
        .from("payment-evidence")
        .download(proof.path);
      if (error || !data) throw new WorkflowError("Evidence unavailable.", 404);
      bytes = new Uint8Array(await data.arrayBuffer());
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline; filename=payment-evidence.png",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Evidence unavailable.",
      },
      { status: error instanceof WorkflowError ? error.status : 403 },
    );
  }
}
