import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ChatArea } from "@/components/chat/ChatArea";
import type { Message, Journey } from "@/lib/data";

interface Props {
  params: Promise<{ conversationId: string }>;
}

export default async function ChatPage({ params }: Props) {
  const { conversationId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Load conversation
  const { data: conv } = await supabase
    .from("conversations")
    .select("*, journeys(*)")
    .eq("id", conversationId)
    .single();

  if (!conv) notFound();

  // Load messages
  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  // Load KOC count for header
  const { count: kocCount } = await supabase
    .from("koc_sources")
    .select("*", { count: "exact", head: true })
    .eq("journey_id", conv.journey_id);

  return (
    <ChatArea
      conversationId={conversationId}
      journey={conv.journeys as Journey}
      initialMessages={(messages ?? []) as Message[]}
      kocCount={kocCount ?? 0}
    />
  );
}
