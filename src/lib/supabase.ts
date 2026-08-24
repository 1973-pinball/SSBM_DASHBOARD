import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";

/**
 * Cloud sync is opt-in infrastructure: without the env vars the app is exactly
 * the local-only tool it always was, and every caller must handle `supabase`
 * being null. Values come from Supabase → Settings → API (see .env.example).
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const configuredSiteUrl = import.meta.env.VITE_SITE_URL as string | undefined;

export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

export const cloudEnabled = supabase !== null;

export type { Session };

const authReturnUrl = (): string => {
  const base = import.meta.env.DEV ? window.location.origin : configuredSiteUrl || window.location.origin;
  const target = new URL(base.endsWith("/") ? base : `${base}/`);
  target.searchParams.set("auth", "return");
  return target.toString();
};

const cleanAuthReturnUrl = () => {
  const current = new URL(window.location.href);
  if (current.searchParams.get("auth") !== "return") return;
  current.searchParams.delete("auth");
  current.hash = "";
  window.history.replaceState(window.history.state, "", `${current.pathname}${current.search}`);
};

export async function signInWithGoogle(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    // Always return to one explicit production URL. Supabase handles the token
    // exchange; cleanAuthReturnUrl removes the temporary marker afterwards.
    options: { redirectTo: authReturnUrl() },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function currentSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  if (data.session) cleanAuthReturnUrl();
  return data.session;
}

/** Subscribe to auth changes; returns an unsubscribe function. */
export function onAuthChange(cb: (session: Session | null) => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session) cleanAuthReturnUrl();
    cb(session);
  });
  return () => data.subscription.unsubscribe();
}
