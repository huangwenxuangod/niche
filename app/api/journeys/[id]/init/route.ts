import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: Params) {
  const { id: journeyId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify ownership
  const { data: journey } = await supabase
    .from("journeys")
    .select("*")
    .eq("id", journeyId)
    .eq("user_id", user.id)
    .single();

  if (!journey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Mark as initialized (manual KOC management)
  await supabase
    .from("journeys")
    .update({ knowledge_initialized: true, init_status: "done" })
    .eq("id", journeyId);

  return NextResponse.json({ status: "done" });
}
