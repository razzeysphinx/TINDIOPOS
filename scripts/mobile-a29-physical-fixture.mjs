import assert from "node:assert/strict";
import {
  requireCanonicalProductionNeonTarget,
} from "./lib/canonical-production-neon-target.mjs";
import { runSql } from "./lib/phase-04-postgres-docker.mjs";

const ORGANIZATION_ID = "baf8e21b-e6e8-4ec9-9cf9-3b8d351e7fb9";
const STORE_ID = "8de6a6de-b006-403e-84eb-c1ac9b36e1c0";
const PRODUCT_ID = "d9a4ebe5-bfb8-46a6-8e83-013fe1be2ed1";

assert.equal(process.env.TINDIO_DATABASE_PROVIDER, "neon", "TINDIO_DATABASE_PROVIDER must be neon.");
const { databaseUrl } = requireCanonicalProductionNeonTarget(process.env.DATABASE_URL_UNPOOLED);
const action = process.argv[2] ?? "status";
assert.ok(["status", "restore", "prune", "archive"].includes(action), "Expected status, restore, prune, or archive.");

const statusSql = `select jsonb_build_object(
  'organizationId','${ORGANIZATION_ID}'::uuid,
  'storeId','${STORE_ID}'::uuid,
  'product',(select jsonb_build_object('id',product.id,'name',product.name,'status',product.status) from public.products product where product.organization_id='${ORGANIZATION_ID}'::uuid and product.id='${PRODUCT_ID}'::uuid),
  'currentRevision',greatest(
    coalesce((select max(change.revision) from public.pos_sync_changes change where change.organization_id='${ORGANIZATION_ID}'::uuid),0),
    coalesce((select retention.retained_after_revision from private.pos_sync_retention_state retention where retention.organization_id='${ORGANIZATION_ID}'::uuid),0)
  ),
  'latestRetainedChangeRevision',coalesce((select max(change.revision) from public.pos_sync_changes change where change.organization_id='${ORGANIZATION_ID}'::uuid),0),
  'retainedAfterRevision',coalesce((select retention.retained_after_revision from private.pos_sync_retention_state retention where retention.organization_id='${ORGANIZATION_ID}'::uuid),0),
  'organizationChangeCount',(select count(*) from public.pos_sync_changes change where change.organization_id='${ORGANIZATION_ID}'::uuid),
  'otherOrganizationChangeCount',(select count(*) from public.pos_sync_changes change where change.organization_id<>'${ORGANIZATION_ID}'::uuid),
  'salesCount',(select count(*) from public.sales row where row.organization_id='${ORGANIZATION_ID}'::uuid),
  'paymentsCount',(select count(*) from public.payments row where row.organization_id='${ORGANIZATION_ID}'::uuid),
  'receiptsCount',(select count(*) from public.receipts row where row.organization_id='${ORGANIZATION_ID}'::uuid),
  'inventoryMovementsCount',(select count(*) from public.inventory_movements row where row.organization_id='${ORGANIZATION_ID}'::uuid),
  'archiveFunctions',coalesce((select jsonb_agg(jsonb_build_object('signature',function.oid::regprocedure::text,'arguments',pg_get_function_arguments(function.oid))) from pg_proc function where function.pronamespace='public'::regnamespace and function.proname='set_catalog_product_archived_safely'),'[]'::jsonb)
)::text;`;

function assertCustodyUnchanged(before, after) {
  assert.equal(after.salesCount, before.salesCount, "Sales changed during the A29 fixture operation.");
  assert.equal(after.paymentsCount, before.paymentsCount, "Payments changed during the A29 fixture operation.");
  assert.equal(after.receiptsCount, before.receiptsCount, "Receipts changed during the A29 fixture operation.");
  assert.equal(
    after.inventoryMovementsCount,
    before.inventoryMovementsCount,
    "Inventory movements changed during the A29 fixture operation.",
  );
}

async function setFixtureArchived(isArchived) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const dataApiUrl = process.env.NEON_DATA_API_URL;
  const credentials = [
    [process.env.TINDIO_PHASE_04_TEST_EMAIL, process.env.TINDIO_PHASE_04_TEST_PASSWORD],
    [process.env.TINDIO_PHASE_05_TEST_EMAIL, process.env.TINDIO_PHASE_05_TEST_PASSWORD],
  ].filter(([email, password]) => email && password);
  assert.ok(supabaseUrl && publishableKey && dataApiUrl && credentials.length > 0, "A29 authenticated fixture environment is incomplete.");

  const attempts = [];
  for (const [email, password] of credentials) {
    const authResponse = await fetch(`${supabaseUrl.replace(/\/$/u, "")}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    if (!authResponse.ok) {
      attempts.push(`auth:${authResponse.status}`);
      continue;
    }
    const auth = await authResponse.json();
    assert.equal(typeof auth.access_token, "string", "Certification authentication returned no access token.");

    const rpcResponse = await fetch(`${dataApiUrl.replace(/\/$/u, "")}/rpc/set_catalog_product_archived_safely`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target_organization_id: ORGANIZATION_ID,
        target_product_id: PRODUCT_ID,
        target_is_archived: isArchived,
      }),
    });
    const responseText = await rpcResponse.text();
    if (rpcResponse.ok) return JSON.parse(responseText);
    attempts.push(`rpc:${rpcResponse.status}`);
  }

  assert.fail(`No dedicated certification identity was authorized for the canonical product RPC (${attempts.join(", ")}).`);
}

const before = JSON.parse(runSql(databaseUrl, statusSql));
assert.equal(before.product?.id, PRODUCT_ID, "Dedicated synthetic product is unavailable.");
assert.match(before.product.name, /^MOB-10 A28 Delta Fixture/);

if (action === "restore" || action === "archive") {
  const archived = action === "archive";
  const expectedBefore = archived ? "active" : "archived";
  const expectedAfter = archived ? "archived" : "active";
  assert.equal(before.product.status, expectedBefore, `Fixture must be ${expectedBefore} before ${action}.`);
  const rpc = await setFixtureArchived(archived);
  const after = JSON.parse(runSql(databaseUrl, statusSql));
  assert.equal(after.product.status, expectedAfter);
  assert.ok(after.currentRevision > before.currentRevision, "Catalog mutation did not create a newer sync revision.");
  assert.equal(after.otherOrganizationChangeCount, before.otherOrganizationChangeCount);
  assertCustodyUnchanged(before, after);
  console.log(JSON.stringify({ action, rpc, before, after }));
} else if (action === "prune") {
  assert.ok(before.currentRevision > before.retainedAfterRevision, "A newer certification-tenant revision is required before pruning.");
  const answer = JSON.parse(runSql(databaseUrl, `select to_jsonb(result)::text from private.prune_pos_sync_changes('${ORGANIZATION_ID}'::uuid,${before.currentRevision}) result;`));
  const after = JSON.parse(runSql(databaseUrl, statusSql));
  assert.equal(after.retainedAfterRevision, before.currentRevision);
  assert.equal(after.currentRevision, before.currentRevision);
  assert.equal(after.organizationChangeCount, 0);
  assert.equal(after.otherOrganizationChangeCount, before.otherOrganizationChangeCount);
  assertCustodyUnchanged(before, after);
  console.log(JSON.stringify({ action, answer, before, after }));
} else {
  console.log(JSON.stringify(before));
}
