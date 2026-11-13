import { LoginForm } from "./LoginForm";
import { NOT_ALLOWED_ERROR, NOT_ALLOWED_MESSAGE } from "@/lib/supabase/allowlist";

const NOTICES: Record<string, string> = {
  [NOT_ALLOWED_ERROR]: NOT_ALLOWED_MESSAGE,
  link: "That sign-in link has expired or was already used. Sign in with your password or request a new link.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const { error } = await searchParams;
  const code = Array.isArray(error) ? error[0] : error;
  return <LoginForm notice={code ? NOTICES[code] : undefined} />;
}
