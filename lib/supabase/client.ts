import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const createClient = () => {
  if (!supabaseUrl || !supabaseKey || supabaseUrl === 'your_supabase_url') {
    // Return mock client if not configured
    return {
      auth: {
        signInWithPassword: async () => ({ error: { message: "请先在 .env.local 中配置 Supabase" } }),
        signUp: async () => ({ error: { message: "请先在 .env.local 中配置 Supabase" } }),
        getSession: async () => ({ data: { session: null } }),
      },
      from: () => ({
        select: () => ({ data: [], error: null }),
        insert: () => ({ data: [], error: null }),
        update: () => ({ data: [], error: null }),
        delete: () => ({ data: [], error: null }),
      }),
    } as any;
  }
  return createBrowserClient(supabaseUrl, supabaseKey);
};
