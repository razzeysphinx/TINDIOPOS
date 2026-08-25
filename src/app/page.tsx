import {
  ArrowUpRight,
  Building2,
  CircleCheck,
  Layers3,
  ReceiptText,
  ShieldCheck,
  Store,
} from "lucide-react";
import Link from "next/link";

import { TindioMark } from "@/components/brand/tindio-mark";
import { buttonVariants } from "@/components/ui/button";

const foundations = [
  {
    icon: Store,
    title: "POS terminal",
    detail: "A focused selling workspace designed for speed at the counter.",
  },
  {
    icon: Building2,
    title: "Back Office",
    detail: "A single place to manage stores, people, products, and reporting.",
  },
  {
    icon: ShieldCheck,
    title: "Secure by design",
    detail: "Organization-scoped access, server validation, and database RLS.",
  },
  {
    icon: ReceiptText,
    title: "Reliable sales",
    detail: "Cash checkout is atomic, idempotent, and recorded with a receipt.",
  },
];

export default function Home() {
  return (
    <main className="min-h-svh bg-background px-5 py-5 sm:px-8 sm:py-8 lg:px-12">
      <div className="mx-auto flex min-h-[calc(100svh-2.5rem)] max-w-6xl flex-col rounded-2xl border border-border bg-card shadow-sm sm:min-h-[calc(100svh-4rem)]">
        <header className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-8">
          <TindioMark />
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground sm:inline-flex">
              <span className="size-1.5 rounded-full bg-primary" />
              Phase 4
            </span>
            <Link className={buttonVariants({ variant: "outline" })} href="/login">
              Sign in
            </Link>
          </div>
        </header>

        <section className="grid flex-1 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="flex flex-col justify-between p-6 sm:p-10 lg:p-14">
            <div>
              <p className="mb-5 flex items-center gap-2 text-sm font-semibold tracking-wide text-primary uppercase">
                <Layers3 className="size-4" />
                Modern point of sale
              </p>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.045em] text-foreground sm:text-5xl lg:text-6xl">
                Sell simple. <span className="text-primary">Grow smarter.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
                TINDIO is being built as a dependable retail operating system:
                fast at checkout, clear for teams, and disciplined with every
                transaction.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link className={buttonVariants({ size: "lg" })} href="/signup">
                  Set up your business
                  <ArrowUpRight aria-hidden="true" />
                </Link>
                <Link
                  className={buttonVariants({ size: "lg", variant: "outline" })}
                  href="/back-office"
                >
                  Open Back Office
                </Link>
              </div>
            </div>

            <div className="mt-12 grid gap-3 sm:grid-cols-2">
              {foundations.map(({ icon: Icon, title, detail }) => (
                <article
                  className="rounded-xl border border-border bg-background p-4"
                  key={title}
                >
                  <Icon className="size-5 text-primary" aria-hidden="true" />
                  <h2 className="mt-5 font-semibold text-foreground">{title}</h2>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    {detail}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <aside className="border-t border-border bg-muted/45 p-6 sm:p-10 lg:border-t-0 lg:border-l lg:p-12">
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Build status</p>
                <CircleCheck className="size-5 text-primary" aria-label="Ready" />
              </div>
              <dl className="mt-6 space-y-4 text-sm">
                <StatusRow label="Application" value="Next.js Back Office" />
                <StatusRow label="Design system" value="TINDIO tokens" />
                <StatusRow label="Data layer" value="Supabase + RLS" />
                <StatusRow label="Current milestone" value="Cash checkout" />
              </dl>
            </div>

            <div className="mt-8 border-l-2 border-primary pl-4">
              <p className="text-sm font-semibold text-foreground">Built to last</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Sales, inventory, payments, and permissions are governed by the
                database—not temporary browser state.
              </p>
            </div>

            <p className="mt-10 flex items-center gap-1.5 text-sm font-medium text-primary">
              Phase 4: cash checkout <ArrowUpRight className="size-4" />
            </p>
          </aside>
        </section>
      </div>
    </main>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border pb-4 last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}
