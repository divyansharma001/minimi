import type { ReactNode } from "react";
import { Figtree } from "next/font/google";
import "./styles.css";

// Figtree: a friendly, open-licence sans close in spirit to Sarvam's Matter.
// next/font serves it from this app, so browsers never contact Google.
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });

export const metadata = {
  title: "minimi",
  description: "A chat agent with web search that remembers what you asked, and checks whether it is still true.",
};

export const viewport = {
  themeColor: "#e6efdc",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={figtree.variable}>
      <body>{children}</body>
    </html>
  );
}
