import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function HomePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Find active journey and its latest conversation
  const { data: journeys } = await supabase
    .from("journeys")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1);

  if (!journeys || journeys.length === 0) {
    redirect("/journey/new");
  }

  const activeJourneyId = journeys[0].id;

  // Get or create a conversation
  const { data: convs } = await supabase
    .from("conversations")
    .select("id")
    .eq("journey_id", activeJourneyId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (convs && convs.length > 0) {
    redirect(`/chat/${convs[0].id}`);
  }

  // No conversation yet — show a landing nudge
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 20,
        padding: 40,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 28,
          fontWeight: 300,
          letterSpacing: "-0.02em",
          color: "var(--text-primary)",
          textAlign: "center",
        }}
      >
        旅程已就绪，<em style={{ color: "var(--accent)", fontStyle: "italic" }}>开始对话吧</em>
      </div>
      <CreateConvButton journeyId={activeJourneyId} />
    </div>
  );
}

function CreateConvButton({ journeyId }: { journeyId: string }) {
  return (
    <form action={`/api/conversations`} method="POST">
      <input type="hidden" name="journey_id" value={journeyId} />
      <Link
        href={`/api/conversations/new?journey_id=${journeyId}`}
        style={{
          display: "inline-block",
          padding: "10px 24px",
          background: "var(--accent)",
          color: "var(--bg-void)",
          borderRadius: 6,
          fontFamily: "var(--font-body)",
          fontSize: 13,
          fontWeight: 500,
          textDecoration: "none",
        }}
      >
        新建对话 →
      </Link>
    </form>
  );
}
