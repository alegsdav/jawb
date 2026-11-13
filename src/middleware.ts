import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail, NOT_ALLOWED_ERROR } from "@/lib/supabase/allowlist";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = path.startsWith("/login") || path.startsWith("/auth");

  // Signed in, but not on ALLOWED_EMAILS (e.g. an account created while sign-ups were open): sign out.
  if (data.user && !isAllowedEmail(data.user.email)) {
    await supabase.auth.signOut().catch(() => {});
    const out = path.startsWith("/api")
      ? NextResponse.json({ error: "This account isn't allowed to use this app." }, { status: 403 })
      : isPublic
        ? NextResponse.next({ request })
        : NextResponse.redirect(loginUrl(request, NOT_ALLOWED_ERROR));
    // Carry the cookie removals signOut queued, and clear any auth cookie it missed.
    response.cookies.getAll().forEach((c) => out.cookies.set(c));
    request.cookies.getAll().forEach(({ name }) => {
      if (name.startsWith("sb-")) out.cookies.set(name, "", { path: "/", maxAge: 0 });
    });
    return out;
  }

  if (!data.user && !isPublic) {
    if (path.startsWith("/api")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    return NextResponse.redirect(loginUrl(request));
  }
  return response;
}

function loginUrl(request: NextRequest, error?: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = error ? `?error=${error}` : "";
  return url;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
