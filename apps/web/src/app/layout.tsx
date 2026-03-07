import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Nav } from "@/components/Nav";
import { WalletProvider } from "@/lib/wallet";

import "./globals.css";

export const metadata: Metadata = {
  title: "SoroRail — reference app",
  description:
    "Reference application for the SoroRail Soroban payment contracts. Testnet only, unaudited.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          {/*
           * The testnet warning is a permanent fixture, not a dismissible
           * toast. The contracts are unaudited, and the one thing this app
           * must never do is let someone believe they are moving real money.
           */}
          <div className="banner">
            <strong>Testnet only.</strong> These contracts are unaudited. Do not
            use them with real value.
          </div>
          <Nav />
          <main className="shell">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
