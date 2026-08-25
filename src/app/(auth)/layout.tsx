import type { ReactNode } from "react";
import Link from "next/link";

import { TindioMark } from "@/components/brand/tindio-mark";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-svh bg-muted/45 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">{children}</div>
      </section>
      <aside className="relative hidden overflow-hidden border-l border-border bg-primary px-12 py-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <Link href="/" aria-label="TINDIO home">
          <TindioMark className="[&_span:last-child]:text-primary-foreground [&_span:first-child]:bg-primary-foreground [&_span:first-child]:text-primary" />
        </Link>
        <div className="max-w-lg">
          <p className="text-sm font-bold tracking-[0.16em] uppercase opacity-75">
            TINDIO Back Office
          </p>
          <p className="mt-5 text-4xl font-semibold tracking-[-0.04em]">
            Your business, clearly organized from day one.
          </p>
          <p className="mt-5 max-w-md text-base leading-7 opacity-80">
            Set up locations, registers, employees, and access with a secure
            multi-store foundation.
          </p>
        </div>
        <p className="text-sm opacity-75">Sell simple. Grow smarter.</p>
      </aside>
    </main>
  );
}
