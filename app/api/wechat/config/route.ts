import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  decryptWechatSecret,
  encryptWechatSecret,
  fetchWechatAccessToken,
} from "@/lib/wechat-publish";

export async function GET() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("wechat_publish_configs")
    .select("id, account_name, app_id, default_author")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ config: data });
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const appId = String(body.app_id || "").trim();
  const appSecret = String(body.app_secret || "").trim();

  if (!appId || !appSecret) {
    return NextResponse.json({ error: "请填写 AppID 和 AppSecret。" }, { status: 400 });
  }

  try {
    await fetchWechatAccessToken(appId, appSecret);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "公众号配置验证失败" },
      { status: 400 }
    );
  }

  const encryptedSecret = encryptWechatSecret(appSecret);
  const { data, error } = await supabase
    .from("wechat_publish_configs")
    .upsert(
      {
        user_id: user.id,
        account_name: null,
        app_id: appId,
        app_secret_encrypted: encryptedSecret,
        default_author: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select("id, account_name, app_id, default_author")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ config: data });
}

export async function PUT(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const appSecret = String(body.app_secret || "").trim();

  const { data: existing, error: existingError } = await supabase
    .from("wechat_publish_configs")
    .select("app_secret_encrypted")
    .eq("user_id", user.id)
    .single();

  if (existingError || !existing) {
    return NextResponse.json({ error: "请先保存公众号配置。" }, { status: 404 });
  }

  const nextSecret = appSecret || decryptWechatSecret(existing.app_secret_encrypted);
  const appId = String(body.app_id || "").trim();

  if (!appId || !nextSecret) {
    return NextResponse.json({ error: "请填写 AppID 和 AppSecret。" }, { status: 400 });
  }

  try {
    await fetchWechatAccessToken(appId, nextSecret);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "公众号配置验证失败" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("wechat_publish_configs")
    .update({
      account_name: null,
      app_id: appId,
      app_secret_encrypted: encryptWechatSecret(nextSecret),
      default_author: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .select("id, account_name, app_id, default_author")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ config: data });
}
