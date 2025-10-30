import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stock Dashboard",
  description: "Watchlist mit Basic-Auth"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
