"use client";

import Link from "next/link";
import { useAuth } from "@/core/auth";

export function Nav() {
  const { me, ready, logout } = useAuth();
  return (
    <header className="nav">
      <Link href="/" className="brand">
        HiFi<span>Stream</span>
      </Link>
      <nav>
        <Link href="/">Discover</Link>
        <Link href="/studio">Studio</Link>
      </nav>
      <div className="nav-user">
        {ready &&
          (me ? (
            <>
              {me.membershipActive && <span className="badge hires">Member</span>}
              <span className="muted">{me.displayName}</span>
              <button className="link" onClick={logout}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login">Sign in</Link>
              <Link href="/register" className="button small">
                Join
              </Link>
            </>
          ))}
      </div>
    </header>
  );
}
