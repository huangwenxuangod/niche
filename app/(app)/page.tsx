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

  let targetJourneyId: string;

  // No journeys at all → create one
  if (!journeys || journeys.length === 0) {
    const { data: newJourney } = await supabase
      .from("journeys")
      .insert({
        user_id: user.id,
        name: "公众号内容增长旅程",
        platform: "wechat_mp",
        keywords: [],
        is_active: true,
        knowledge_initialized: false,
        init_status: "pending",
      })
      .select("id")
      .single();

    if (!newJourney) {
      throw new Error("Failed to create journey");
    }
    targetJourneyId = newJourney.id;
  } else {
    // Has journeys → find or create conversation for latest/active journey
    const { data: activeJourneys } = await supabase
      .from("journeys")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1);

    targetJourneyId = activeJourneys?.[0]?.id ?? journeys[0].id;
  }

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
  throw new Error("Failed to navigate to conversation");
}
