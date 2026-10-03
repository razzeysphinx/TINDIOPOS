# TINDIO

**Sell simple. Grow smarter.**

Phase 7 adds customer CRM and loyalty: customer profiles, purchase history, configurable earning and redemption, and an immutable points ledger.

TINDIO is a modern point-of-sale and business management system. Phases 1–6 provide the secure business foundation, multi-store product catalogue, accountable basic inventory, configurable checkout, receipt history, controlled refunds, and register cash control. This includes authentication, atomic organization onboarding, role-based access, categories, simple and variant products, pricing, barcodes, store availability, current stock, a movement ledger, cash tender/change, receipts, idempotent sales, partial or full refunds, opening/closing shifts, and immutable pay-in/pay-out records.

Phase 7 extends that foundation with organization-scoped customer records, purchase history, configurable loyalty earning/redemption, and a ledger-derived points balance.

## Stack

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, shadcn/ui, and Lucide
- Supabase Auth for authentication and session authority
- Neon PostgreSQL for authoritative TINDIO business data and Row Level Security
- React Hook Form and Zod for client and server validation
- Canonical schema tooling in `database/baseline`, `database/migrations`, and
  `database/provider/*`

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add the project URL and publishable key from the Supabase Connect panel.
3. Start the local Supabase runtime: `pnpm exec supabase start`.
4. Install the canonical schema into that disposable local database:
   `TINDIO_DATABASE_INSTALL=YES pnpm db:install:local`.
5. Run `pnpm dev` and visit `http://127.0.0.1:3000`.

```env
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Only client-safe values belong in these variables. Never place a service-role key or database password in a `NEXT_PUBLIC_*` variable.

## Implemented flow

```text
Create account
→ verify the cookie-backed session
→ create organization, default roles, store, register, and owner atomically
→ create additional stores, registers, and least-privilege custom roles
→ invite employees with an expiring, email-bound link
→ configure categories, products, variants, prices, barcodes, and store availability
→ record opening stock and signed inventory adjustments
→ review current balances and movement history in the protected Back Office
→ open an assigned register shift and record its opening cash
→ open POS, browse or scan saleable items, and build a temporary cart
→ select an active register, take cash, calculate change, and complete checkout
→ write the sale, payment, receipt, and tracked inventory deductions atomically
→ record pay-ins/pay-outs, count the drawer, and close against server-derived expected cash
```

The browser does not determine access. Server-side JWT verification and database RLS scope every organization query. Product creation and inventory changes run through validated database routines. Cost data requires a separate permission, stock projections cannot be written directly, and each accepted stock change creates an immutable ledger entry in the same transaction.

The POS verifies the cashier's active shift before it loads the product workspace. With no active shift, TINDIO renders only the opening-shift gate; product search, barcode entry, cart actions, checkout, and the catalogue endpoint remain unavailable. Checkout accepts only item references, quantities, selected register, validated payment method IDs/amounts, and an idempotency key; the database reconstructs prices, computes totals/change, creates payment snapshots and the receipt, and records tracked stock deductions as one transaction. A sale or refund is linked atomically to the cashier's open register shift. Receipt history and thermal-friendly reprints read immutable snapshots. Refunds use a separate idempotent transaction that cannot edit the original sale and restores only stock that was originally tracked. Shift closing locks the drawer ledger, derives expected cash from opening cash, net cash payments, cash refunds, pay-ins, and pay-outs, then permanently records the count and difference.

Customer profiles are visible only to authorized CRM managers. The POS customer lookup has its own store-assignment and active-shift guard and returns only the fields required for a sale. Loyalty balances are never a writable field: earnings, redemptions, and refund reversals append immutable `loyalty_transactions` rows. Redemptions use an internal `LOYALTY` voucher tender, preserving merchandise totals, payment records, refund values, and shift cash expectations.

## Quality checks

```powershell
pnpm typecheck
pnpm lint
pnpm build
pnpm exec supabase test db
pnpm exec supabase db advisors --local --type all --level warn --fail-on warn
```

The database test requires Docker Desktop and a running local Supabase stack.
The local runtime supplies Auth infrastructure; the business schema is installed
from the canonical baseline, ordered forward migrations, and the local provider
adapter. Fresh Neon installations use `TINDIO_DATABASE_INSTALL=YES`,
`TINDIO_DATABASE_PROVIDER=neon`, and a direct `DATABASE_URL_UNPOOLED` with
`pnpm db:install:neon`; production never uses recovery scripts. Historical
Supabase migrations are retained as recovery history and are not the supported
installation path. See [the architecture contract](docs/architecture.md) for
table relationships and security boundaries.
