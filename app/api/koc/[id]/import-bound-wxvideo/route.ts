import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { importBoundWxvideoFromKoc } from "@/lib/wxvideo-import";

interface Params {
  params: Promise<{ id: string }>;
}

type BoundWxvideoKocSource = {
  id: string;
  journey_id: string;
  account_name: string | null;
  account_id: string | null;
  ghid?: string | null;
};

export async function POST(_req: NextRequest, { params }: Params) {
  const { id: kocId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: koc } = (await supabase
    .from("koc_sources")
    .select("id, journey_id, account_name, account_id, ghid")
    .eq("id", kocId)
    .single()) as { data: BoundWxvideoKocSource | null };

  if (!koc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: journey } = await supabase
    .from("journeys")
    .select("id")
    .eq("id", koc.journey_id)
    .eq("user_id", user.id)
    .single();

  if (!journey) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await importBoundWxvideoFromKoc(supabase, koc);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[import-bound-wxvideo] failed", error);
    const message = error instanceof Error ? error.message : "Import failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
