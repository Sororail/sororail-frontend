"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { FRIENDBOT_URL, shortAddress } from "@/lib/network";
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
  const { address, connect, disconnect, connecting, error } = useWallet();

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
        <div className="nav__inner" style={{ paddingTop: 0 }}>
          <div className="notice notice--error" style={{ width: "100%" }}>
            <div>{error}</div>
            <div className="notice__detail">
              Freighter is the supported wallet. A testnet account also needs
              funding —{" "}
              <a href={FRIENDBOT_URL} target="_blank" rel="noreferrer">
                friendbot
              </a>{" "}
              will do it.
            </div>
          </div>
        </div>
      ) : null}
    </nav>
  );
}
