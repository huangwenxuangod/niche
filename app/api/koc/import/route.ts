import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { importKocForJourney } from "@/lib/koc-import";

export async function POST(req: NextRequest) {
  const { input, journey_id } = await req.json();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify journey ownership
  const { data: journey } = await supabase
    .from("journeys")
    .select("*")
    .eq("id", journey_id)
    .eq("user_id", user.id)
    .single();

  if (!journey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const result = await importKocForJourney(
      supabase,
      journey_id,
      input
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("Import failed:", err);
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message?: unknown }).message || "Import failed")
          : "Import failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
