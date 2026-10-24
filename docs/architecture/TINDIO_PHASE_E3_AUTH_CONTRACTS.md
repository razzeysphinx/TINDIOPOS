# TINDIO Phase E3 provider-neutral Auth contracts

Status: **E3 COMPLETE — SUPABASE DEFAULT; NEON ADAPTER DISABLED**

Completed: 2026-10-24

E3 introduces the application-owned Auth boundary required before any client can
exercise the isolated Neon Auth environment. It changes no provider endpoint,
credential, cookie name, secure-storage key, deployment, or database policy.
Supabase remains the only enabled runtime provider.

## Shared contract

`@tindio/contracts/auth` now owns:

- the `supabase | neon` provider vocabulary and `supabase` default;
- normalized identity, session, credentials, failures, state events, and
  verified-claims values;
- client-session and bearer-token verifier adapter interfaces; and
- an explicit selector that rejects unknown providers and any known provider
  not included in the calling runtime's allowlist.

The shared package remains platform neutral. It imports no Next.js, Expo,
React Native, Supabase, Neon, filesystem, or environment implementation.

## Runtime adapters

- **Web:** server and browser Supabase client creation now passes through the
  Web selector. An absent selection resolves to Supabase. `neon` and unknown
  values throw before a provider client is created.
- **Backend:** a provider-neutral bearer verifier normalizes verified Supabase
  claims. The high-reuse POS read runtime now consumes it and preserves the
  existing raw claims envelope expected by all owned read handlers.
- **Mobile:** session recovery, refresh, password sign-in, sign-out, Auth state
  changes, auto-refresh lifecycle, and POS bearer-token retrieval now use a
  normalized adapter. Supabase SecureStore persistence remains unchanged.

These are Supabase adapters behind provider-neutral interfaces, not a Neon
integration. No Neon SDK was installed and no Neon Auth/Data API URL appears in
application source or environment configuration.

## Fail-closed boundary

Every E3 runtime supplies `['supabase']` as its enabled-provider allowlist.
Setting a Web, Backend, or Mobile provider selector to `neon` therefore fails
with `AUTH_PROVIDER_NOT_ENABLED`. This is intentional until an isolated Neon
adapter is implemented and directly proven in a later slice.

The 13-flow Phase E matrix remains unchanged: every flow is `NOT_RUN`. Compile,
source, and adapter-selection tests are architecture evidence only and are not
treated as signup, login, refresh, RLS, revocation, or rollback proof.

## Next slice

E4 should implement the first isolated Neon Web adapter and local-only proof
harness against the expiring E2 branch. Supabase must remain the default, no
deployed origin may change, and only flows with direct runtime evidence may be
promoted from `NOT_RUN`.
