# @tindio/contracts

Platform-neutral, versioned contracts shared by TINDIO Web, Mobile, and the
future dedicated Backend application.

The package currently owns the stable POS API version identifier plus the
provider-neutral device credential, enrollment, validation, request-header,
binding, and sequence/checkpoint contracts. It also owns the independent sync
domain, baseline, cursor-expiry, device-delta, catalogue/customer/reference-data,
delta-pull, controlled-resnapshot, modifier, cart-line, store, register,
active-shift, open-ticket, ticket-assignee, and shift-response contracts. The existing
`src/contracts/pos.ts` and `src/features/devices/device-schema.ts` modules remain
compatibility facades while the remaining Web-feature and generated-database
dependencies are separated in focused, compatibility-tested slices.

This package must not import Next.js, React Native, privileged database clients,
filesystem APIs, or secret environment variables.
