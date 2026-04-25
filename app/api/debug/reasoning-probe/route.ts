import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { runReasoningCapabilityProbe } from "@/lib/agent/reasoning-probe";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const prompt =
      typeof body?.prompt === "string" && body.prompt.trim()
        ? body.prompt.trim()
        : undefined;

    const report = await runReasoningCapabilityProbe(prompt);
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "reasoning probe failed",
      },
      { status: 500 }
    );
  }
}
