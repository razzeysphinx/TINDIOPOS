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
] =
  await Promise.all([
    source(
      "src/lib/auth/dal.ts",
    ),

    source(
      "src/lib/supabase/context-client.ts",
    ),
  ]);

test(
  "cookie BusinessContext carries a verified server-side authorization header",
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
      /createClient\(\{[\s\S]*Authorization:[\s\S]*authorizationHeader/,
    );

    assert.match(
      dal,
      /resolveVerifiedUser\([\s\S]*supabase[\s\S]*accessToken/,
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
  "authenticated context client preserves identity for bearer and cookie transports",
  () => {
    assert.match(
      contextClient,
      /transport[\s\S]*=== "bearer"/,
    );

    assert.match(
      contextClient,
      /transport[\s\S]*=== "cookie"/,
    );

    assert.match(
      contextClient,
      /headers\.Authorization[\s\S]*authorizationHeader/,
    );

    assert.match(
      contextClient,
      /name\.toLowerCase\(\)[\s\S]*!== "authorization"/,
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
