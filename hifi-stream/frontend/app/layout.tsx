import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { PlayerBar } from "@/components/PlayerBar";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "HiFi Stream",
  description: "Lossless 24-bit streaming that pays the artists you actually listen to.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Nav />
          <main className="container">{children}</main>
          <PlayerBar />
        </Providers>
      </body>
    </html>
  );
}
