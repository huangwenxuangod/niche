import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { journey_id, account_name } = await req.json();

  // Verify journey ownership
  const { data: journey } = await supabase
    .from("journeys")
    .select("id")
    .eq("id", journey_id)
    .eq("user_id", user.id)
    .single();

  if (!journey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: koc, error } = await supabase
    .from("koc_sources")
    .insert({
      journey_id,
      platform: "wechat_mp",
      account_name,
      is_manually_added: true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(koc);
}
