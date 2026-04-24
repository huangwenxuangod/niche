import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar/Sidebar";
import type { Journey, Conversation } from "@/lib/data";
import { getJourneyProjectMemory } from "@/lib/memory";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Load journeys and active journey's conversations
  const { data: journeys } = await supabase
    .from("journeys")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const activeJourney = (journeys ?? []).find((j: Journey) => j.is_active) ?? null;

  let conversations: Conversation[] = [];
  let activeProjectMemory = null;
  if (activeJourney) {
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .eq("journey_id", activeJourney.id)
      .order("created_at", { ascending: false })
      .limit(30);
    conversations = data ?? [];
    activeProjectMemory = await getJourneyProjectMemory(supabase, activeJourney.id);
  }

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "var(--bg-void)",
      }}
    >
      <Sidebar
        journeys={journeys ?? []}
        activeJourney={activeJourney}
        conversations={conversations}
        activeProjectMemory={activeProjectMemory}
      />
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {children}
      </main>
    </div>
  );
}
