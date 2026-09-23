import assert from "node:assert/strict";
import {
  readdir,
  readFile,
} from "node:fs/promises";
import test from "node:test";

const migrationsDirectory =
  new URL(
    "../supabase/migrations/",
    import.meta.url,
  );

const migrationNames =
  await readdir(
    migrationsDirectory,
  );

const matches =
  migrationNames
    .filter(
      (name) =>
        name.endsWith(
          "_phase_04_provider_neutral_time_clock_runtime.sql",
        ),
    );

assert.equal(
  matches.length,
  1,
  `Expected exactly one Phase 04 provider-neutral time-clock migration; found ${matches.length}.`,
);

const migration =
  await readFile(
    new URL(
      `../supabase/migrations/${matches[0]}`,
      import.meta.url,
    ),
    "utf8",
  );

function definition(
  name,
) {
  const match =
    migration.match(
      new RegExp(
        `create or replace function private\\.${name}\\([\\s\\S]*?\\$\\$;`,
        "i",
      ),
    );

  assert.ok(
    match,
    `Missing private.${name}.`,
  );

  return match[0];
}

function body(
  name,
) {
  const match =
    definition(
      name,
    ).match(
      /as\s+\$\$([\s\S]*?)\$\$;/i,
    );

  assert.ok(
    match,
    `Unable to extract private.${name} body.`,
  );

  return match[1];
}

const functions = [
  "clock_in_employee",
  "clock_out_employee",
  "get_current_time_clock_entry",
];

test(
  "time-clock migration replaces only the approved runtime family",
  () => {
    const created = [
      ...migration.matchAll(
        /create or replace function private\.([a-z0-9_]+)\(/gi,
      ),
    ].map(
      (match) =>
        match[1],
    );

    assert.deepEqual(
      created.sort(),
      [...functions].sort(),
    );

    assert.doesNotMatch(
      migration,
      /\b(create|alter|drop)\s+policy\b/i,
    );

    assert.doesNotMatch(
      migration,
      /\balter\s+table\b/i,
    );

    assert.doesNotMatch(
      migration,
      /\bdrop\s+(table|column)\b/i,
    );
  },
);

test(
  "time-clock runtime contains no direct provider identity primitive",
  () => {
    for (
      const name
      of functions
    ) {
      const runtime =
        body(
          name,
        );

      assert.doesNotMatch(
        runtime,
        /auth\.uid\s*\(/i,
      );

      assert.doesNotMatch(
        runtime,
        /auth\.user_id\s*\(/i,
      );

      assert.doesNotMatch(
        runtime,
        /auth\.jwt\s*\(/i,
      );

      assert.match(
        runtime,
        /public\.current_profile_id\s*\(\s*\)/i,
      );
    }
  },
);

test(
  "clock-in preserves store assignment and replay protections",
  () => {
    const runtime =
      body(
        "clock_in_employee",
      );

    assert.match(
      runtime,
      /public\.employee_stores/i,
    );

    assert.match(
      runtime,
      /public\.stores/i,
    );

    assert.match(
      runtime,
      /store\.is_active/i,
    );

    assert.match(
      runtime,
      /for key share/i,
    );

    assert.match(
      runtime,
      /for update/i,
    );

    assert.match(
      runtime,
      /was_replayed/i,
    );
  },
);

test(
  "clock-out preserves employee lock and open-entry requirement",
  () => {
    const runtime =
      body(
        "clock_out_employee",
      );

    assert.match(
      runtime,
      /for key share/i,
    );

    assert.match(
      runtime,
      /clocked_out_at is null/i,
    );

    assert.match(
      runtime,
      /There is no open time-clock entry to close/i,
    );
  },
);

test(
  "current time-clock lookup preserves organization and active-entry scope",
  () => {
    const runtime =
      body(
        "get_current_time_clock_entry",
      );

    assert.match(
      runtime,
      /employee\.organization_id/i,
    );

    assert.match(
      runtime,
      /employee\.status[\s\S]*'active'/i,
    );

    assert.match(
      runtime,
      /entry\.clocked_out_at is null/i,
    );
  },
);

test(
  "authenticated execution grants remain explicit",
  () => {
    for (
      const name
      of functions
    ) {
      assert.match(
        migration,
        new RegExp(
          `grant execute[\\s\\S]*private\\.${name}[\\s\\S]*to authenticated`,
          "i",
        ),
      );
    }
  },
);
