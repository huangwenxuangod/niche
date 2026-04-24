import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  buildIdentityMemo,
  getUserMemory,
  parseIdentityMemo,
  saveUserMemory,
  syncUserIdentityMemory,
  syncUserIdentityProfileMemory,
  type IdentityProfile,
} from "@/lib/memory";

export async function GET() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("identity_memo")
    .eq("user_id", user.id)
    .single();

  const markdown = (await getUserMemory(supabase, user.id)) || (await syncUserIdentityMemory(supabase, user.id, profile?.identity_memo ?? ""));

  return NextResponse.json({
    identity_memo: profile?.identity_memo ?? "",
    identity_profile: parseIdentityMemo(profile?.identity_memo ?? ""),
    memory_markdown: markdown,
  });
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const rawIdentityMemo = String(body.identity_memo ?? "");
  const identityProfile = normalizeIdentityProfile(body.identity_profile);
  const identityMemo = identityProfile ? buildIdentityMemo(identityProfile) : rawIdentityMemo;
  const memoryMarkdown = String(body.memory_markdown ?? "");

  await supabase.from("user_profiles").upsert(
    {
      user_id: user.id,
      identity_memo: identityMemo,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (memoryMarkdown.trim()) {
    await saveUserMemory(supabase, user.id, memoryMarkdown);
  } else if (identityProfile) {
    await syncUserIdentityProfileMemory(supabase, user.id, identityProfile);
  } else {
    await syncUserIdentityMemory(supabase, user.id, identityMemo);
  }

  return NextResponse.json({ success: true });
}

function normalizeIdentityProfile(value: unknown): IdentityProfile | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  return {
    role: String(source.role ?? "").trim(),
    stage: String(source.stage ?? "").trim(),
    platform: String(source.platform ?? "").trim(),
    targetAudience: String(source.targetAudience ?? "").trim(),
    goal: String(source.goal ?? "").trim(),
    contentStyle: String(source.contentStyle ?? "").trim(),
    extra: String(source.extra ?? "").trim(),
  };
}
