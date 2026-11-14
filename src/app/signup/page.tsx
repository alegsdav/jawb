import type { Metadata } from "next";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Create your account · Job Pipeline" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const { code } = await searchParams;
  return <SignupForm initialCode={(Array.isArray(code) ? code[0] : code) ?? ""} />;
}
