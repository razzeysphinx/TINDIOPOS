# @tindio/contracts

Platform-neutral, versioned contracts shared by TINDIO Web, Mobile, and the
future dedicated Backend application.

This foundation slice intentionally exports only the already-stable POS API
version identifier. The existing `src/contracts/pos.ts` remains the compatibility
facade until its imports from Web features and generated database types are
separated in focused, compatibility-tested slices.

This package must not import Next.js, React Native, privileged database clients,
filesystem APIs, or secret environment variables.
