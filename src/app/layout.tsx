import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const ui = Plus_Jakarta_Sans({ variable: "--font-ui", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Job Pipeline",
  description: "Tailor your resume to every job and track applications.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${ui.variable} antialiased`}>{children}</body>
    </html>
  );
}
