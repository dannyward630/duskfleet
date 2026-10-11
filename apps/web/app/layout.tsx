import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { NavTabs } from "@/components/NavTabs";

export const metadata: Metadata = {
  title: "DuskFleet",
  description: "Agents and runs dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <nav className="nav" aria-label="Main">
            <Link href="/" className="brand">
              <span className="dot" />
              DuskFleet
            </Link>
            <NavTabs />
            {/* Pages with live data mount <AutoRefresh> here (portal). */}
            <span className="meta" id="nav-meta" />
          </nav>
          {children}
        </div>
      </body>
    </html>
  );
}
