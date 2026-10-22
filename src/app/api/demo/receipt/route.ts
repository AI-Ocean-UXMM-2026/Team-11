import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDemoMode } from "@/lib/supabase/config";
import { localRoot } from "@/lib/workflow/local";

export async function GET() {
  if (!isDemoMode()) return new Response("Not found", { status: 404 });
  try {
    const bytes = await readFile(
      path.join(localRoot(), "samples", "demo-receipt.png"),
    );
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": 'attachment; filename="demo-receipt.png"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response(
      "Open the demo workspace first to prepare its sample receipt.",
      { status: 404 },
    );
  }
}
