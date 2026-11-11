import type { ReactNode } from "react";

export const metadata = {
  title: "minimi",
  description: "A chat agent with web search that remembers past chats by date.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#ffffff",
          color: "#1f2328",
        }}
      >
        {children}
      </body>
    </html>
  );
}
