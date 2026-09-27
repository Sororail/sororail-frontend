"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { shortAddress } from "@/lib/network";
import { useWallet } from "@/lib/wallet";

const links = [
  { href: "/", label: "Overview" },
  { href: "/payroll", label: "Payroll" },
  { href: "/streams", label: "Streams" },
  { href: "/vesting", label: "Vesting" },
  { href: "/escrow", label: "Escrow" },
];

export function Nav() {
  const pathname = usePathname();
  const { address, connect, disconnect, connecting, error, networkError } =
    useWallet();

  return (
    <nav className="nav">
      <div className="nav__inner">
        <Link className="nav__brand" href="/">
          SoroRail
        </Link>
        {links.map((link) => {
          const active =
            link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`nav__link${active ? " nav__link--active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {link.label}
            </Link>
          );
        })}

        <div className="nav__spacer" />

        {address ? (
          <div className="row">
            <span className="addr" title={address}>
              {shortAddress(address, 6)}
            </span>
            <button type="button" className="button--quiet" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="button--primary"
            onClick={() => void connect()}
            disabled={connecting}
          >
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
        )}
      </div>

      {error ? (
        <div className="nav__inner nav__feedback">
          <div className="notice notice--error" role="alert">
            <div>{error.message}</div>
          </div>
        </div>
      ) : null}

      {networkError ? (
        <div className="nav__inner nav__feedback">
          <div className="notice notice--error" role="alert">
            <div className="notice__title">Wrong network in Freighter</div>
            <div>{networkError}</div>
            <div className="notice__detail">
              Open Freighter, choose the network menu at the top, and select
              Testnet. This page updates on its own once it matches.
            </div>
          </div>
        </div>
      ) : null}
    </nav>
  );
}
