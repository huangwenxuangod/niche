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

  // Verify journey ownership
  const { data: journey } = await supabase
    .from("journeys")
    .select("*")
    .eq("id", journeyId)
    .eq("user_id", user.id)
    .single();

  if (!journey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Check if there's already a conversation for this journey
  const { data: existingConv } = await supabase
    .from("conversations")
    .select("id")
    .eq("journey_id", journeyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingConv) {
    return NextResponse.json({ conversation_id: existingConv.id });
  }

  // Create new conversation
  const { data: conv, error } = await supabase
    .from("conversations")
    .insert({
      journey_id: journeyId,
      user_id: user.id,
      title: "新对话",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversation_id: conv.id });
}
