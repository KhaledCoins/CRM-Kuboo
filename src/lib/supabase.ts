import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const SUPABASE_CONFIGURED = !!(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl.startsWith("https://") &&
  supabaseAnonKey.length > 20
);

export const supabase = SUPABASE_CONFIGURED
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
