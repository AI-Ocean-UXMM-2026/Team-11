import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  executeWorkflow,
  workflowActor,
  workflowSnapshot,
  WorkflowError,
} from "@/lib/workflow/server";
import { validateProof } from "@/lib/workflow/images";
import { samePortalOrigin } from "@/lib/workflow/origin";
import { localObject, localRoot, localIdentity } from "@/lib/workflow/local";
import { isDemoMode, supabaseConfig } from "@/lib/supabase/config";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!samePortalOrigin(request))
      throw new WorkflowError("Upload from this portal only.", 403);
    const actor = await workflowActor();
    if (actor.role !== "sme")
      throw new WorkflowError("Only SMEs can upload payment evidence.", 403);
    const length = Number(request.headers.get("content-length"));
    if (!length || length > 6 * 1024 * 1024)
      throw new WorkflowError("Use a payment image under 5 MB.", 413);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new WorkflowError("Choose a PNG or JPEG payment image.");
    const bytes = await validateProof(
      Buffer.from(await file.arrayBuffer()),
      file.type,
    );
    const key = String(form.get("operationKey"));
    const { id } = await params;
    const intent = await executeWorkflow(
      actor,
      "proof_intent",
      { orderId: id, digest: createHash("sha256").update(bytes).digest("hex") },
      key,
    );
    if (!intent.path || !intent.intentId)
      throw new Error("Upload could not be authorized.");
    if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.png$/.test(intent.path))
      throw new Error("Invalid proof path.");
    if (isDemoMode()) {
      const folder = path.join(localRoot(), "payment-evidence", id);
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, `${intent.intentId}.png`), bytes);
      await localObject(actor.id, intent.path);
    } else {
      const { url } = supabaseConfig();
      const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!secret)
        throw new WorkflowError(
          "HQ must configure private proof storage on the server.",
          503,
        );
      const admin = createClient(url, secret, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await admin.storage
        .from("payment-evidence")
        .upload(intent.path, bytes, { contentType: "image/png", upsert: true });
      if (error)
        throw new Error("Private proof upload failed. Retry this submission.");
    }
    const result = await executeWorkflow(
      actor,
      "submit_evidence",
      {
        orderId: id,
        intentId: intent.intentId,
        amount: Number(form.get("amount")),
        reference: String(form.get("reference") ?? ""),
      },
      localIdentity(key + ":submit"),
    );
    return Response.json(
      { result, data: await workflowSnapshot(actor) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: error instanceof WorkflowError ? error.status : 400 },
    );
  }
}
