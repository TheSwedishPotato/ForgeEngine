"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/core/auth";
import { PlayerProvider } from "./PlayerProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <PlayerProvider>{children}</PlayerProvider>
    </AuthProvider>
  );
}
