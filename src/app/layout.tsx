import type { Metadata } from "next";
import { Inter, Young_Serif } from "next/font/google";
import "./globals.css";
import "./fonts.css";

const ui = Inter({ variable: "--font-ui", subsets: ["latin"], weight: ["400", "500", "600"] });
/** The wordmark's face (Wordmark in icons.tsx). */
const brand = Young_Serif({ variable: "--font-young-serif", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "Jawb",
  description: "Tailor your resume to every job and track applications.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${ui.variable} ${brand.variable} antialiased`}>{children}</body>
    </html>
  );
}
