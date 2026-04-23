import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { IdentityForm } from "./IdentityForm";
import { getUserMemory, syncUserIdentityMemory } from "@/lib/memory";

export default async function ProfilePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("identity_memo")
    .eq("user_id", user.id)
    .single();

  const memoryMarkdown =
    (await getUserMemory(user.id)) ||
    (await syncUserIdentityMemory(user.id, profile?.identity_memo ?? ""));

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
        身份配置
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 300, letterSpacing: "-0.02em", color: "var(--text-primary)", marginBottom: 8 }}>
        我是谁
      </div>
      <div style={{ fontSize: 13, color: "var(--text-tertiary)", marginBottom: 32, lineHeight: 1.6 }}>
        用几句话描述你自己，AI 会在每次对话中记住这些信息，给出更有针对性的建议。
      </div>
      <IdentityForm
        initialValue={profile?.identity_memo ?? ""}
        initialMemory={memoryMarkdown}
      />
    </div>
  );
}
