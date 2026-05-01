import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { IdentityForm } from "./IdentityForm";
import { extractIdentityMemoFromUserMemory, getUserMemory } from "@/lib/memory";

export default async function ProfilePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const memoryMarkdown = await getUserMemory(supabase, user.id);
  const identityMemo = extractIdentityMemoFromUserMemory(memoryMarkdown);

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "48px 40px",
        maxWidth: 600,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 12 }}>
        认知母本
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 300, letterSpacing: "-0.02em", color: "var(--text-primary)", marginBottom: 8 }}>
        我的认知
      </div>
      <div style={{ fontSize: 13, color: "var(--text-tertiary)", marginBottom: 32, lineHeight: 1.6 }}>
        用 Markdown 持续沉淀你的判断、经历、长期主题和核心对标。AI 不只是记住你是谁，而是逐步记住你在意什么、相信什么、还没想透什么。
      </div>
      <IdentityForm
        initialValue={identityMemo}
        initialMemory={memoryMarkdown}
      />
    </div>
  );
}
