# TINDIO Final Pre-Production — Phase 7 Security Boundary Assessment

## Scope

Phase 7 verifies that sensitive TINDIO operations remain authorized by the active server-side business context, PostgreSQL grants/RLS, and RPC checks. It does not replace database authorization with frontend permissions or alter production schema.

## Boundary model verified

1. Server actions and API routes obtain the active business context from the authenticated session.
2. Client-supplied organization identifiers are never used as authority; sensitive RPCs receive `context.organization.id`.
3. Store-bound POS operations validate assigned-store membership before calling the checkout RPC.
4. PostgreSQL grants and RLS prevent direct mutations where an RPC is required, and the RPCs enforce membership, permission, organization, store/register, shift, and device conditions.

## Attack-test matrix

| Negative path | Executable evidence |
| --- | --- |
| Cashier invokes an administrative role command | `phase_7_security_boundary_hardening.test.sql` verifies direct RLS mutation changes zero rows and the system cashier role remains unchanged. `phase_1_rls.test.sql` also verifies a manager cannot grant authority they do not hold. |
| Store A caller reads or writes Store B data | `phase_1_rls.test.sql`, `phase_2_rls.test.sql`, and `phase_4_cash_checkout.test.sql` verify cross-organization/store isolation. |
| Caller modifies the organization identifier | `phase_4_cash_checkout.test.sql` rejects a cross-tenant checkout; the POS device API rejects a request organization that differs from the active context. |
| Checkout after shift close | `phase_6_register_shifts.test.sql` rejects direct checkout after the current shift closes. |
| Unauthorized inventory adjustment | `phase_2_rls.test.sql` rejects a cashier inventory adjustment. |
| Unauthorized refund | `phase_5_receipts_refunds.test.sql` rejects refunds by a cashier without `sales.refund`. |
| Revoked device request | `improvement_12_device_register_management.test.sql` rejects the revoked device credential. |
| Unauthorized tax-setting change | `phase_7_security_boundary_hardening.test.sql` verifies the cashier has no `products.manage` permission, RLS changes zero rows, and the tax rate is unchanged. |
| Payment configuration or business-feature change | `improvement_5_payment_configuration.test.sql` and `improvement_11_business_profile_features.test.sql` reject unauthorized callers. |

## High-risk dependencies

- Supabase Auth session/JWT claims must reach the server and Data API unchanged.
- The local/production database must apply the versioned migrations before the matching pgTAP suite is used as release evidence.
- Device enforcement depends on the POS sending the registered device credential; the RPC remains authoritative if the client is modified.

## Acceptance criteria

- The Phase 7 source guardrail, focused pgTAP attack tests, full database test suite, typecheck, lint, and production build pass.
- No production migration, RLS policy, grant, or frontend-only authorization layer is introduced by this phase.

## Local verification evidence — 2026-08-27

- `npm run test:security-boundaries`: 4 passed.
- Focused pgTAP attack suite: 9 files and 206 tests passed.
- Full local pgTAP suite: 40 files and 894 tests passed.
- Local Supabase Security Advisor at warning level: no issues found.
- `npm run typecheck` and `npm run build`: passed.
- `npm run lint`: no errors; the pre-existing `no-img-element` warning in `src/app/(back-office)/back-office/catalog/page.tsx` remains.
