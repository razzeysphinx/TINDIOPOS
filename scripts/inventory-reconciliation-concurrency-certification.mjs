import {
  randomUUID,
} from "node:crypto";

import process from "node:process";

import {
  createClient,
} from "@supabase/supabase-js";

import {
  reconcileInventoryState,
} from "./lib/inventory-reconciliation.mjs";

import {
  parseAndValidateLocalSupabaseStatus,
} from "./lib/certification-safety.mjs";

import {
  runCommand,
} from "./lib/run-command.mjs";

const ROOT =
  process.cwd();

const REQUEST_TIMEOUT_MS =
  20_000;

const EXPECTED_LOCAL_DB_CONTAINER =
  "supabase_db_tindio_pos";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(
  message,
) {
  throw new Error(
    message,
  );
}

function assertCondition(
  condition,
  message,
) {
  if (!condition) {
    fail(
      message,
    );
  }
}

function safeErrorMessage(
  error,
) {
  if (
    !error
    || typeof error
      !== "object"
  ) {
    return "unknown failure";
  }

  const code =
    typeof error.code
      === "string"
      ? error.code
      : "unknown";

  const message =
    typeof error.message
      === "string"
      ? error.message
      : "request failed";

  return (
    `${code}: ${message}`
  );
}

async function withTimeout(
  promise,
  label,
) {
  let timeout;

  try {
    return await Promise.race([
      promise,

      new Promise(
        (
          _resolve,
          reject,
        ) => {
          timeout =
            setTimeout(
              () => {
                reject(
                  new Error(
                    `${label} timed out.`,
                  ),
                );
              },
              REQUEST_TIMEOUT_MS,
            );
        },
      ),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(
        timeout,
      );
    }
  }
}

function localSupabaseStatus() {
  const result =
    runCommand(
      "pnpm",
      [
        "exec",
        "supabase",
        "status",
        "--output",
        "json",
      ],
      {
        cwd:
          ROOT,

        env:
          process.env,

        capture:
          true,
      },
    );

  if (
    result.error
    || result.status
      !== 0
  ) {
    fail(
      "Unable to read local Supabase status.",
    );
  }

  const output =
    result.stdout
    ?? "";

  parseAndValidateLocalSupabaseStatus(
    output,
  );

  let status;

  try {
    status =
      JSON.parse(
        output,
      );
  } catch {
    fail(
      "Local Supabase status JSON could not be parsed.",
    );
  }

  for (
    const field
    of [
      "API_URL",
      "DB_URL",
      "ANON_KEY",
      "SERVICE_ROLE_KEY",
    ]
  ) {
    if (
      typeof status[field]
        !== "string"
      || status[field]
        .trim()
        === ""
    ) {
      fail(
        `Local Supabase status is missing ${field}.`,
      );
    }
  }

  return status;
}

function localDatabaseContainer() {
  const result =
    runCommand(
      "docker",
      [
        "ps",
        "--format",
        "{{.Names}}",
      ],
      {
        cwd:
          ROOT,

        env:
          process.env,

        capture:
          true,
      },
    );

  if (
    result.error
    || result.status
      !== 0
  ) {
    fail(
      "Unable to enumerate local Docker containers for Phase 03 evidence.",
    );
  }

  const names =
    String(
      result.stdout
      ?? "",
    )
      .split(
        /\r?\n/,
      )
      .map(
        (
          value,
        ) =>
          value.trim(),
      )
      .filter(
        Boolean,
      );

  const matches =
    names.filter(
      (
        name,
      ) =>
        name
          .toLowerCase()
          === EXPECTED_LOCAL_DB_CONTAINER,
    );

  if (
    matches.length
    !== 1
  ) {
    fail(
      "Expected exactly one running local Supabase database container for TINDIO_POS.",
    );
  }

  return matches[0];
}

function localReadOnlySql(
  containerName,
  sql,
) {
  const normalized =
    String(
      sql,
    )
      .trim();

  if (
    !/^select\b/i.test(
      normalized,
    )
  ) {
    fail(
      "Phase 03 local database introspection accepts SELECT statements only.",
    );
  }

  const result =
    runCommand(
      "docker",
      [
        "exec",

        "-e",
        "PGOPTIONS=-c default_transaction_read_only=on",

        containerName,

        "psql",

        "-U",
        "postgres",

        "-d",
        "postgres",

        "-X",
        "-q",
        "-A",
        "-t",

        "-v",
        "ON_ERROR_STOP=1",

        "-c",
        normalized,
      ],
      {
        cwd:
          ROOT,

        env:
          process.env,

        capture:
          true,
      },
    );

  if (
    result.error
    || result.status
      !== 0
  ) {
    fail(
      "Local read-only PostgreSQL evidence query failed.",
    );
  }

  return String(
    result.stdout
    ?? "",
  )
    .trim();
}

function sqlUuid(
  value,
  label,
) {
  if (
    typeof value
      !== "string"
    || !UUID_PATTERN.test(
      value,
    )
  ) {
    fail(
      `${label} is not a valid UUID.`,
    );
  }

  return (
    `'${value}'::uuid`
  );
}

function localJsonQuery(
  containerName,
  sql,
  label,
) {
  const output =
    localReadOnlySql(
      containerName,
      sql,
    );

  if (
    output === ""
  ) {
    fail(
      `${label} returned no JSON payload.`,
    );
  }

  try {
    const parsed =
      JSON.parse(
        output,
      );

    if (
      !Array.isArray(
        parsed,
      )
    ) {
      fail(
        `${label} did not return a JSON array.`,
      );
    }

    return parsed;
  } catch (
    error
  ) {
    if (
      error instanceof Error
      && error.message
        .includes(
          "did not return",
        )
    ) {
      throw error;
    }

    fail(
      `${label} returned invalid JSON.`,
    );
  }
}

function localScalarNumber(
  containerName,
  sql,
  label,
) {
  const output =
    localReadOnlySql(
      containerName,
      sql,
    );

  const lines =
    output
      .split(
        /\r?\n/,
      )
      .map(
        (
          value,
        ) =>
          value.trim(),
      )
      .filter(
        Boolean,
      );

  if (
    lines.length
    !== 1
  ) {
    fail(
      `${label} did not return exactly one row.`,
    );
  }

  const value =
    Number(
      lines[0],
    );

  if (
    !Number.isFinite(
      value,
    )
  ) {
    fail(
      `${label} returned a non-numeric value.`,
    );
  }

  return value;
}

function createLocalClient(
  apiUrl,
  key,
) {
  return createClient(
    apiUrl,
    key,
    {
      auth: {
        autoRefreshToken:
          false,

        detectSessionInUrl:
          false,

        persistSession:
          false,
      },
    },
  );
}

async function rpc(
  client,
  functionName,
  args,
  label,
) {
  const {
    data,
    error,
  } =
    await client.rpc(
      functionName,
      args,
    );

  if (error) {
    const wrapped =
      new Error(
        `${label}: ${safeErrorMessage(error)}`,
      );

    wrapped.code =
      error.code;

    throw wrapped;
  }

  return data;
}

async function signIn(
  client,
  email,
  password,
  label,
) {
  const {
    data,
    error,
  } =
    await client.auth
      .signInWithPassword({
        email,
        password,
      });

  if (error) {
    fail(
      `${label}: ${safeErrorMessage(error)}`,
    );
  }

  assertCondition(
    Boolean(
      data.session,
    ),
    `${label}: no authenticated session was returned.`,
  );
}

function projectedQuantity({
  containerName,
  organizationId,
  storeId,
  productId,
}) {
  return localScalarNumber(
    containerName,
    `
      select level.quantity::text
      from public.inventory_levels level
      where level.organization_id = ${sqlUuid(
        organizationId,
        "organizationId",
      )}
        and level.store_id = ${sqlUuid(
          storeId,
          "storeId",
        )}
        and level.product_id = ${sqlUuid(
          productId,
          "productId",
        )}
        and level.variant_id is null
      limit 2
    `,
    "Fixture stock projection",
  );
}

function adjustmentHeadersForOperations({
  containerName,
  organizationId,
  operationIds,
}) {
  assertCondition(
    Array.isArray(
      operationIds,
    )
    && operationIds.length
      > 0,
    "At least one operation ID is required.",
  );

  const operationList =
    operationIds
      .map(
        (
          value,
          index,
        ) =>
          sqlUuid(
            value,
            `operationIds[${index}]`,
          ),
      )
      .join(
        ", ",
      );

  return localJsonQuery(
    containerName,
    `
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id',
            adjustment.id,
            'operation_id',
            adjustment.operation_id
          )
          order by adjustment.id
        ),
        '[]'::jsonb
      )::text
      from public.inventory_adjustments adjustment
      where adjustment.organization_id = ${sqlUuid(
        organizationId,
        "organizationId",
      )}
        and adjustment.operation_id in (${operationList})
    `,
    "Adjustment operation evidence",
  );
}

function movementCountForAdjustment({
  containerName,
  organizationId,
  adjustmentId,
}) {
  return localScalarNumber(
    containerName,
    `
      select count(*)::text
      from public.inventory_movements movement
      where movement.organization_id = ${sqlUuid(
        organizationId,
        "organizationId",
      )}
        and movement.source_type = 'inventory_adjustment'
        and movement.source_id = ${sqlUuid(
          adjustmentId,
          "adjustmentId",
        )}
    `,
    "Adjustment ledger movement count",
  );
}

function allReconciliationRows(
  containerName,
) {
  const levels =
    localJsonQuery(
      containerName,
      `
        select coalesce(
          jsonb_agg(
            to_jsonb(snapshot)
            order by
              snapshot.organization_id,
              snapshot.store_id,
              snapshot.product_id,
              snapshot.variant_id nulls first
          ),
          '[]'::jsonb
        )::text
        from (
          select
            level.organization_id,
            level.store_id,
            level.product_id,
            level.variant_id,
            level.quantity
          from public.inventory_levels level
        ) snapshot
      `,
      "Inventory projection snapshot",
    );

  const movements =
    localJsonQuery(
      containerName,
      `
        select coalesce(
          jsonb_agg(
            to_jsonb(snapshot)
            order by
              snapshot.organization_id,
              snapshot.store_id,
              snapshot.product_id,
              snapshot.variant_id nulls first,
              snapshot.created_at,
              snapshot.id
          ),
          '[]'::jsonb
        )::text
        from (
          select
            movement.id,
            movement.organization_id,
            movement.store_id,
            movement.product_id,
            movement.variant_id,
            movement.quantity_before,
            movement.quantity_delta,
            movement.quantity_after,
            movement.created_at,
            movement.operation_id,
            movement.source_id,
            movement.source_type
          from public.inventory_movements movement
        ) snapshot
      `,
      "Inventory ledger snapshot",
    );

  return {
    levels,
    movements,
  };
}

function adjustmentArgs({
  organizationId,
  storeId,
  productId,
  quantityDelta,
  operationId,
  note,
}) {
  return {
    target_approval_request_id:
      null,

    target_note:
      note,

    target_operation_id:
      operationId,

    target_organization_id:
      organizationId,

    target_product_id:
      productId,

    target_quantity_delta:
      quantityDelta,

    target_reason_code:
      "PHASE03_DAMAGE",

    target_store_id:
      storeId,

    target_variant_id:
      null,
  };
}

async function main() {
  console.log(
    "TINDIO INVENTORY RECONCILIATION & CONCURRENCY EVIDENCE",
  );

  console.log(
    "======================================================",
  );

  const status =
    localSupabaseStatus();

  const apiUrl =
    status.API_URL;

  const anonKey =
    status.ANON_KEY;

  const serviceRoleKey =
    status.SERVICE_ROLE_KEY;

  /*
   * Discovery occurs only after API_URL and DB_URL have already passed the
   * fail-closed localhost validation above.
   */
  const containerName =
    localDatabaseContainer();

  /*
   * SERVICE_ROLE_KEY is used only for local Auth administration so the
   * harness can create its disposable owner identity.
   *
   * It is intentionally NOT used for direct inventory table reads.
   */
  const authAdmin =
    createLocalClient(
      apiUrl,
      serviceRoleKey,
    );

  /*
   * These two clients exercise the real authenticated Data API / RPC path.
   * They are separate HTTP/auth sessions so Promise.allSettled below creates
   * actual concurrent requests rather than a sequential SQL simulation.
   */
  const clientA =
    createLocalClient(
      apiUrl,
      anonKey,
    );

  const clientB =
    createLocalClient(
      apiUrl,
      anonKey,
    );

  const runId =
    randomUUID();

  const email =
    `phase03-${runId}@tindio.test`;

  const password =
    `Tindio-Phase03-${randomUUID()}!`;

  const {
    data:
      createdUser,
    error:
      createUserError,
  } =
    await authAdmin.auth
      .admin
      .createUser({
        email,
        password,
        email_confirm:
          true,

        user_metadata: {
          full_name:
            "Phase 03 Concurrency Owner",
        },
      });

  if (
    createUserError
  ) {
    fail(
      `Unable to create local concurrency user: ${safeErrorMessage(createUserError)}`,
    );
  }

  assertCondition(
    Boolean(
      createdUser.user,
    ),
    "Local concurrency user was not created.",
  );

  await Promise.all([
    signIn(
      clientA,
      email,
      password,
      "Concurrency client A sign-in failed",
    ),

    signIn(
      clientB,
      email,
      password,
      "Concurrency client B sign-in failed",
    ),
  ]);

  const bootstrapData =
    await rpc(
      clientA,
      "bootstrap_organization",
      {
        organization_name:
          `Phase 03 Concurrency ${runId.slice(0, 8)}`,

        register_name:
          "Phase 03 Register",

        store_name:
          "Phase 03 Store",
      },
      "Unable to bootstrap the Phase 03 organization",
    );

  const bootstrap =
    Array.isArray(
      bootstrapData,
    )
      ? bootstrapData[0]
      : bootstrapData;

  assertCondition(
    Boolean(
      bootstrap
      && bootstrap
        .organization_id
      && bootstrap
        .store_id,
    ),
    "Bootstrap did not return organization/store identifiers.",
  );

  const organizationId =
    bootstrap
      .organization_id;

  const storeId =
    bootstrap
      .store_id;

  await rpc(
    clientA,
    "create_inventory_adjustment_reason",
    {
      target_code:
        "PHASE03_DAMAGE",

      target_movement_type:
        "DAMAGE",

      target_name:
        "Phase 03 concurrency adjustment",

      target_organization_id:
        organizationId,
    },
    "Unable to create the Phase 03 adjustment reason",
  );

  await rpc(
    clientA,
    "update_organization_inventory_policy",
    {
      target_organization_id:
        organizationId,

      target_negative_stock_policy:
        "block",
    },
    "Unable to force the local fixture negative-stock policy to block",
  );

  const uniqueDigits =
    Date.now()
      .toString()
      .slice(-12);

  const productId =
    await rpc(
      clientA,
      "create_catalog_product",
      {
        target_barcode:
          `9${uniqueDigits}`,

        target_category_id:
          null,

        target_cost_minor:
          500,

        target_description:
          "Phase 03 same-key concurrency fixture.",

        target_name:
          "Phase 03 Concurrency Item",

        target_organization_id:
          organizationId,

        target_price_minor:
          1000,

        target_product_type:
          "simple",

        target_sku:
          `PHASE03-${runId.slice(0, 8)}`,

        target_store_ids: [
          storeId,
        ],

        target_track_inventory:
          true,

        target_unit:
          "each",

        target_variants:
          [],
      },
      "Unable to create the Phase 03 tracked product",
    );

  assertCondition(
    typeof productId
      === "string",
    "Catalog creation did not return a product ID.",
  );

  await rpc(
    clientA,
    "record_inventory_adjustment_v3",
    adjustmentArgs({
      organizationId,
      storeId,
      productId,
      quantityDelta:
        10,
      operationId:
        randomUUID(),
      note:
        "Phase 03 opening stock fixture.",
    }),
    "Unable to seed Phase 03 opening stock",
  );

  assertCondition(
    projectedQuantity({
      containerName,
      organizationId,
      storeId,
      productId,
    })
      === 10,
    "Opening stock projection is not ten.",
  );

  /*
   * Scenario 1:
   *
   * Two separate authenticated HTTP sessions decrement the same stock key
   * simultaneously. Starting stock is 10. Each requests -6.
   *
   * Correct serialized result:
   *
   *   exactly one succeeds
   *   exactly one rejects
   *   final stock = 4
   *   one adjustment document
   *   one ledger movement
   */
  const collisionOperationA =
    randomUUID();

  const collisionOperationB =
    randomUUID();

  const collisionResults =
    await Promise.allSettled([
      withTimeout(
        rpc(
          clientA,
          "record_inventory_adjustment_v3",
          adjustmentArgs({
            organizationId,
            storeId,
            productId,
            quantityDelta:
              -6,
            operationId:
              collisionOperationA,
            note:
              "Phase 03 simultaneous decrement A.",
          }),
          "Simultaneous decrement A failed",
        ),
        "Simultaneous decrement A",
      ),

      withTimeout(
        rpc(
          clientB,
          "record_inventory_adjustment_v3",
          adjustmentArgs({
            organizationId,
            storeId,
            productId,
            quantityDelta:
              -6,
            operationId:
              collisionOperationB,
            note:
              "Phase 03 simultaneous decrement B.",
          }),
          "Simultaneous decrement B failed",
        ),
        "Simultaneous decrement B",
      ),
    ]);

  const collisionSuccesses =
    collisionResults.filter(
      (
        result,
      ) =>
        result.status
        === "fulfilled",
    );

  const collisionFailures =
    collisionResults.filter(
      (
        result,
      ) =>
        result.status
        === "rejected",
    );

  assertCondition(
    collisionSuccesses.length
      === 1
    && collisionFailures.length
      === 1,
    "Same-key concurrent decrements must produce exactly one success and one rejection.",
  );

  assertCondition(
    projectedQuantity({
      containerName,
      organizationId,
      storeId,
      productId,
    })
      === 4,
    "Concurrent decrement serialization produced the wrong stock projection.",
  );

  const collisionHeaders =
    adjustmentHeadersForOperations({
      containerName,
      organizationId,
      operationIds: [
        collisionOperationA,
        collisionOperationB,
      ],
    });

  assertCondition(
    collisionHeaders.length
      === 1,
    "Concurrent decrements created an unexpected number of adjustment headers.",
  );

  assertCondition(
    movementCountForAdjustment({
      containerName,
      organizationId,
      adjustmentId:
        collisionHeaders[0]
          .id,
    })
      === 1,
    "Concurrent decrements created an unexpected number of ledger movements.",
  );

  /*
   * Scenario 2:
   *
   * Two separate authenticated sessions submit the exact same operation ID
   * simultaneously.
   *
   * Correct result:
   *
   *   both callers resolve successfully/replay
   *   both resolve to the same document
   *   stock changes once
   *   one adjustment document
   *   one ledger movement
   */
  const duplicateOperationId =
    randomUUID();

  const duplicateArgs =
    adjustmentArgs({
      organizationId,
      storeId,
      productId,
      quantityDelta:
        -1,
      operationId:
        duplicateOperationId,
      note:
        "Phase 03 concurrent duplicate replay.",
    });

  const duplicateResults =
    await Promise.allSettled([
      withTimeout(
        rpc(
          clientA,
          "record_inventory_adjustment_v3",
          duplicateArgs,
          "Concurrent duplicate request A failed",
        ),
        "Concurrent duplicate request A",
      ),

      withTimeout(
        rpc(
          clientB,
          "record_inventory_adjustment_v3",
          duplicateArgs,
          "Concurrent duplicate request B failed",
        ),
        "Concurrent duplicate request B",
      ),
    ]);

  assertCondition(
    duplicateResults.every(
      (
        result,
      ) =>
        result.status
        === "fulfilled",
    ),
    "Concurrent exact retries must both resolve successfully.",
  );

  const duplicateValues =
    duplicateResults.map(
      (
        result,
      ) =>
        result.status
        === "fulfilled"
          ? result.value
          : null,
    );

  assertCondition(
    new Set(
      duplicateValues,
    ).size
      === 1,
    "Concurrent exact retries did not resolve to one adjustment identity.",
  );

  assertCondition(
    projectedQuantity({
      containerName,
      organizationId,
      storeId,
      productId,
    })
      === 3,
    "Concurrent idempotent replay changed stock more than once.",
  );

  const duplicateHeaders =
    adjustmentHeadersForOperations({
      containerName,
      organizationId,
      operationIds: [
        duplicateOperationId,
      ],
    });

  assertCondition(
    duplicateHeaders.length
      === 1,
    "Concurrent idempotent replay created duplicate adjustment headers.",
  );

  assertCondition(
    movementCountForAdjustment({
      containerName,
      organizationId,
      adjustmentId:
        duplicateHeaders[0]
          .id,
    })
      === 1,
    "Concurrent idempotent replay created duplicate ledger movements.",
  );

  /*
   * Global reconciliation.
   *
   * No writer is active at this point. The local certification database is
   * quiescent, so a read-only PostgreSQL snapshot is sufficient evidence.
   *
   * The SQL channel is deliberately separate from PostgREST permissions:
   *
   *   - RPC behavior is exercised as an authenticated application user.
   *   - evidence inspection is a local-only, read-only PostgreSQL session.
   *
   * No production permission is widened merely for certification.
   */
  const {
    levels,
    movements,
  } =
    allReconciliationRows(
      containerName,
    );

  const reconciliation =
    reconcileInventoryState({
      levels,
      movements,
    });

  if (
    !reconciliation.ok
  ) {
    const sample =
      reconciliation
        .anomalies
        .slice(
          0,
          10,
        );

    console.error(
      JSON.stringify(
        {
          anomalyCount:
            reconciliation
              .anomalyCount,

          anomalyCounts:
            reconciliation
              .anomalyCounts,

          sample,
        },
        null,
        2,
      ),
    );

    fail(
      "Inventory ledger/projection reconciliation found structural anomalies.",
    );
  }

  console.log(
    JSON.stringify(
      {
        sameKeyCollision: {
          successes:
            collisionSuccesses
              .length,

          rejections:
            collisionFailures
              .length,

          finalQuantity:
            4,

          adjustmentHeaders:
            collisionHeaders
              .length,
        },

        concurrentReplay: {
          successfulCallers:
            duplicateResults
              .length,

          finalQuantity:
            3,

          adjustmentHeaders:
            duplicateHeaders
              .length,
        },

        reconciliation: {
          projectionKeyCount:
            reconciliation
              .projectionKeyCount,

          ledgerKeyCount:
            reconciliation
              .ledgerKeyCount,

          movementCount:
            reconciliation
              .movementCount,

          anomalyCount:
            reconciliation
              .anomalyCount,
        },
      },
      null,
      2,
    ),
  );

  console.log(
    "INVENTORY RECONCILIATION & CONCURRENCY EVIDENCE: PASS",
  );
}

try {
  await main();
} catch (
  error
) {
  console.error(
    error instanceof Error
      ? error.message
      : "Phase 03 inventory evidence failed.",
  );

  process.exit(
    1,
  );
}
