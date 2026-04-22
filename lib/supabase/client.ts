import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

console.log("[supabase/client] Debug:");
console.log("  NEXT_PUBLIC_SUPABASE_URL:", supabaseUrl);
console.log("  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:", supabaseKey ? "***SET***" : "undefined");

export const createClient = () => {
  if (!supabaseUrl || !supabaseKey || supabaseUrl === 'your_supabase_url') {
    console.warn("[supabase/client] Supabase not configured - returning mock client");
    // Return a mock client that doesn't crash
    return {
      auth: {
        signInWithPassword: async () => ({ error: { message: "请先配置 Supabase 环境变量" } }),
        signUp: async () => ({ error: { message: "请先配置 Supabase 环境变量" } }),
      }
    } as any;
  }
  return createBrowserClient(supabaseUrl!, supabaseKey!);
};
