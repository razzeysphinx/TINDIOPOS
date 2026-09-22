import process from "node:process";

const baseUrl =
  process.env
    .NEXT_PUBLIC_SUPABASE_URL;

if (!baseUrl) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL is required.",
  );
  process.exit(1);
}

const jwksUrl =
  new URL(
    "/auth/v1/.well-known/jwks.json",
    baseUrl,
  );

const response =
  await fetch(jwksUrl);

if (!response.ok) {
  console.error(
    `Supabase JWKS request failed with HTTP ${response.status}.`,
  );
  process.exit(1);
}

const body =
  await response.json();

const keys =
  Array.isArray(body?.keys)
    ? body.keys
    : [];

if (keys.length === 0) {
  console.error(
    "Supabase JWKS contains no public signing keys. Phase 04 requires asymmetric Supabase JWT signing before Neon Data API external-auth cutover.",
  );
  process.exit(1);
}

const asymmetric =
  keys.filter(
    (key) =>
      key
      && typeof key === "object"
      && ["RSA", "EC", "OKP"]
        .includes(key.kty),
  );

if (asymmetric.length === 0) {
  console.error(
    "Supabase JWKS has no asymmetric verification key.",
  );
  process.exit(1);
}

console.log(
  `SUPABASE JWKS: PASS — ${asymmetric.length} asymmetric verification key(s) available.`,
);
