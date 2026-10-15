import type { ReactNode } from "react";
import Link from "next/link";

import { TindioMark } from "@/components/brand/tindio-mark";

export function PublicInformationPage({
  children,
  description,
  eyebrow,
  title,
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <main className="min-h-svh bg-background px-5 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-5 sm:px-10">
          <Link aria-label="TINDIO home" href="/">
            <TindioMark />
          </Link>
          <nav aria-label="Public information" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
            <Link className="text-primary hover:underline" href="/privacy">Privacy</Link>
            <Link className="text-primary hover:underline" href="/support">Support</Link>
            <Link className="text-primary hover:underline" href="/account-deletion">Delete account</Link>
          </nav>
        </header>
        <article className="px-6 py-8 sm:px-10 sm:py-12">
          <p className="text-sm font-semibold tracking-wide text-primary uppercase">{eyebrow}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">{title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">{description}</p>
          <div className="mt-10 space-y-9 text-sm leading-7 text-foreground [&_a]:font-semibold [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-[-0.02em] [&_li]:ml-5 [&_li]:list-disc [&_p+p]:mt-3 [&_ul]:mt-3 [&_ul]:space-y-1.5">
            {children}
          </div>
        </article>
        <footer className="border-t border-border bg-muted/35 px-6 py-5 text-sm text-muted-foreground sm:px-10">
          TINDIO POS · package com.tindio.pos
        </footer>
      </div>
    </main>
  );
}
