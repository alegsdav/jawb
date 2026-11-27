import type { Metadata } from "next";
import { SignupForm } from "./SignupForm";
import { AuthShell, AuthTopLink } from "@/components/AuthShell";
import { LoginPreview } from "@/components/LoginPreview";

export const metadata: Metadata = { title: "Create your account · Jawb" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const { code } = await searchParams;
  return (
    <AuthShell
      topLink={
        <AuthTopLink lead="Already have an account?" href="/login">
          Sign in
        </AuthTopLink>
      }
      preview={<LoginPreview />}
    >
      <SignupForm initialCode={(Array.isArray(code) ? code[0] : code) ?? ""} />
    </AuthShell>
  );
}
