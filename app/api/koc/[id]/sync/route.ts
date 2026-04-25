import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { KOCSource } from "@/lib/data";
import { syncKocSourceArticles } from "@/lib/koc-import";

interface Params {
  params: Promise<{ id: string }>;
}

type SyncableKocSource = KOCSource & {
  ghid?: string | null;
  wxid?: string | null;
  avg_top_read?: number | null;
};

export async function POST(_req: NextRequest, { params }: Params) {
  const { id: kocId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: koc } = await supabase
    .from("koc_sources")
    .select("*")
    .eq("id", kocId)
    .single() as { data: SyncableKocSource | null };

  if (!koc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: journey } = await supabase
    .from("journeys")
    .select("id")
    .eq("id", koc.journey_id)
    .eq("user_id", user.id)
    .single();

  if (!journey) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!koc.account_name && !koc.wxid && !koc.ghid && !koc.account_id) {
    return NextResponse.json({ error: "No account identifier" }, { status: 400 });
  }

  try {
    const result = await syncKocSourceArticles(supabase, koc, 3);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Sync failed:", err);
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
