import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isAllowedUser } from "./allowlist";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component; middleware refreshes the session.
          }
        },
      },
    },
  );
}

/**
 * Returns the signed-in user, or null when nobody is signed in or the account is neither invited nor
 * on ALLOWED_EMAILS (see isAllowedUser). Use in API routes to gate access.
 */
export async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user && isAllowedUser(data.user) ? data.user : null;
  return { supabase, user };
}
