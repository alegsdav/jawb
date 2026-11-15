import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

const ui = Poppins({ variable: "--font-ui", subsets: ["latin"], weight: ["400", "500", "600"] });

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
