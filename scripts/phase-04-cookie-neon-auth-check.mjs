import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";
import test from "node:test";

async function source(
  path,
) {
  return readFile(
    new URL(
      `../${path}`,
      import.meta.url,
    ),
    "utf8",
  );
}

const [
  dal,
  contextClient,
  authenticatedDatabaseClient,
] =
  await Promise.all([
    source(
      "src/lib/auth/dal.ts",
    ),

    source(
      "src/lib/supabase/context-client.ts",
    ),

    source(
      "src/lib/supabase/authenticated-database-client.ts",
    ),
  ]);

test(
  "cookie BusinessContext keeps session verification separate from database identity",
  () => {
    assert.match(
      dal,
      /transport:\s*"cookie";[\s\S]*authorizationHeader:\s*string;/,
    );

    assert.match(
      dal,
      /cookieClient\.auth[\s\S]*\.getSession\(\)/,
    );

    assert.match(
      dal,
      /sessionData[\s\S]*session[\s\S]*access_token/,
    );

    assert.match(
      dal,
      /authorizationHeader[\s\S]*Bearer/,
    );

    assert.match(
      dal,
      /createAuthenticatedDatabaseClient/,
    );

    assert.match(
      dal,
      /resolveVerifiedUser\([\s\S]*cookieClient[\s\S]*accessToken[\s\S]*databaseClient/,
    );

    assert.match(
      dal,
      /requestAuth:[\s\S]*transport:[\s\S]*"cookie"[\s\S]*authorizationHeader/,
    );
  },
);

test(
  "cookie token is verified before business context loading",
  () => {
    const contextDefinition =
      dal.match(
        /export const getBusinessContext = cache\([\s\S]*?\n\);/,
      )?.[0];

    assert.ok(
      contextDefinition,
      "Unable to locate getBusinessContext.",
    );

    const verifyIndex =
      contextDefinition.indexOf(
        "resolveVerifiedUser",
      );

    const loadIndex =
      contextDefinition.indexOf(
        "loadBusinessContext",
      );

    assert.ok(
      verifyIndex >= 0,
      "Cookie context does not verify the session token.",
    );

    assert.ok(
      loadIndex > verifyIndex,
      "Business context loads before cookie token verification.",
    );
  },
);

test(
  "authenticated database transport binds the verified token without SSR cookies",
  () => {
    assert.match(
      authenticatedDatabaseClient,
      /createClient as createSupabaseClient/,
    );

    assert.match(
      authenticatedDatabaseClient,
      /accessToken:[\s\S]*async[\s\S]*token/,
    );

    assert.match(
      authenticatedDatabaseClient,
      /createNeonDataApiFetch/,
    );

    assert.doesNotMatch(
      authenticatedDatabaseClient,
      /createServerClient/,
    );

    assert.match(
      authenticatedDatabaseClient,
      /normalized[\s\S]*!== "authorization"/,
    );

    assert.match(
      contextClient,
      /createAuthenticatedDatabaseClient/,
    );

    assert.doesNotMatch(
      contextClient,
      /createClient\(/,
    );
  },
);

test(
  "cookie authorization remains server-only context metadata",
  () => {
    assert.doesNotMatch(
      dal,
      /NEXT_PUBLIC_[A-Z0-9_]*AUTHORIZATION/i,
    );

    assert.doesNotMatch(
      contextClient,
      /NEXT_PUBLIC_[A-Z0-9_]*AUTHORIZATION/i,
    );

    assert.doesNotMatch(
      dal,
      /console\.(?:log|error|warn)\([\s\S]*authorizationHeader/i,
    );
  },
);
