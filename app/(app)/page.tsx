import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Find any journey (not just active)
  const { data: journeys } = await supabase
    .from("journeys")
    .select("id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1);

  // No journeys at all → go to new journey page
  if (!journeys || journeys.length === 0) {
    redirect("/journey/new");
  }

  // Has journeys → find or create conversation for latest/active journey
  const { data: activeJourneys } = await supabase
    .from("journeys")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1);

  const targetJourneyId = activeJourneys?.[0]?.id ?? journeys[0].id;

  // Get latest conversation or create one
  const { data: convs } = await supabase
    .from("conversations")
    .select("id")
    .eq("journey_id", targetJourneyId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (convs && convs.length > 0) {
    redirect(`/chat/${convs[0].id}`);
  }

  // No conversation yet — create one
  const { data: newConv } = await supabase
    .from("conversations")
    .insert({ journey_id: targetJourneyId, user_id: user.id, title: "新对话" })
    .select()
    .single();

  if (newConv) {
    redirect(`/chat/${newConv.id}`);
  }

  // Fallback
  redirect("/journey/new");
}
