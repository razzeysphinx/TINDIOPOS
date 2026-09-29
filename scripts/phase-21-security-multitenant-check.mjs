import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) =>
  fs.readFileSync(
    path,
    "utf8",
  );

test(
  "mobile cache reads are tenant/store scoped",
  () => {
    const files = {
      catalog:
        read(
          "apps/mobile/src/db/catalog-cache.ts",
        ),
      customers:
        read(
          "apps/mobile/src/db/customer-cache.ts",
        ),
      receipts:
        read(
          "apps/mobile/src/db/receipt-cache.ts",
        ),
      stock:
        read(
          "apps/mobile/src/db/stock-estimate-cache.ts",
        ),
      modifiers:
        read(
          "apps/mobile/src/db/modifier-cache.ts",
        ),
      context:
        read(
          "apps/mobile/src/db/business-context-cache.ts",
        ),
      reference:
        read(
          "apps/mobile/src/db/reference-cache.ts",
        ),
      shift:
        read(
          "apps/mobile/src/db/shift-cache.ts",
        ),
      outbox:
        read(
          "apps/mobile/src/db/outbox.ts",
        ),
      hub:
        read(
          "apps/mobile/src/db/store-hub-cache.ts",
        ),
      cursor:
        read(
          "apps/mobile/src/db/sync-cursor.ts",
        ),
    };

    assert.ok(
      files.catalog.includes(
        "WHERE organization_id = ? AND store_id = ?",
      )
      || files.catalog.includes(
        "WHERE organization_id=? AND store_id=?",
      ),
    );

    assert.ok(
      files.customers.includes(
        "WHERE organization_id=? AND store_id=?",
      ),
    );

    assert.ok(
      files.receipts.includes(
        "WHERE organization_id=?",
      ),
    );

    assert.ok(
      files.stock.includes(
        "WHERE organization_id=? AND store_id=?",
      ),
    );

    assert.ok(
      files.modifiers.includes(
        "WHERE organization_id=? AND store_id=?",
      ),
    );

    assert.ok(
      files.context.includes(
        "WHERE organization_id = ?",
      ),
    );

    assert.ok(
      files.reference.includes(
        "WHERE organization_id = ?",
      ),
    );

    assert.ok(
      files.shift.includes(
        "WHERE organization_id = ? AND store_id = ? AND register_id = ?",
      ),
    );

    assert.ok(
      files.outbox.includes(
        "WHERE organization_id = ? AND event_id = ?",
      ),
      "outbox mutation must require tenant scope",
    );

    assert.ok(
      files.hub.includes(
        "WHERE organization_id=? AND store_id=?",
      ),
    );

    assert.ok(
      files.cursor.includes(
        "WHERE organization_id=? AND device_id=? AND store_id=?",
      ),
    );
  },
);

test(
  "server sync rejects tampered organization and device context",
  () => {
    const syncService =
      read(
        "src/features/offline/pos-v2-sync-service.ts",
      );

    const offlineCheckout =
      read(
        "src/features/offline/pos-v2-offline-checkout-service.ts",
      );

    const syncPush =
      read(
        "src/app/api/pos/v2/sync/push/route.ts",
      );

    assert.ok(
      syncService.includes(
        "input.organizationId!==context.organization.id",
      ),
      "tampered organization ID must be rejected",
    );

    assert.ok(
      syncService.includes(
        'database.rpc("validate_pos_device"',
      ),
      "device validation must be server-side",
    );

    assert.ok(
      offlineCheckout.includes(
        "offline.deviceId!==parsed.data.device.deviceId",
      ),
      "offline envelope device ID must match credential device ID",
    );

    assert.ok(
      offlineCheckout.includes(
        "String(device.store_id)!==parsed.data.checkout.storeId",
      )
      && offlineCheckout.includes(
        "String(device.register_id)!==parsed.data.checkout.registerId",
      ),
      "tampered store/register must be rejected against server device binding",
    );

    assert.ok(
      syncPush.includes(
        "event.offline.deviceId!==parsed.data.device.deviceId",
      )
      && syncPush.includes(
        "event.offline.deviceSequence<=last",
      ),
      "sync batch must reject mismatched devices and replay/out-of-order sequences",
    );
  },
);

test(
  "stale offline authorization fails closed",
  () => {
    const authorization =
      read(
        "apps/mobile/src/features/offline/offline-authorization.ts",
      );

    assert.ok(
      authorization.includes(
        "OFFLINE_AUTHORIZATION_WINDOW_MS",
      )
      && authorization.includes(
        "CLOCK_ROLLBACK",
      )
      && authorization.includes(
        "EXPIRED",
      ),
    );
  },
);

test(
  "device credentials remain organization scoped and outside SQLite transaction events",
  () => {
    const deviceStore =
      read(
        "apps/mobile/src/features/device/device-store.ts",
      );

    const outbox =
      read(
        "apps/mobile/src/db/outbox.ts",
      );

    assert.ok(
      deviceStore.includes(
        "`tindio.pos.device.${organizationId}`",
      ),
      "device SecureStore key must be tenant scoped",
    );

    assert.doesNotMatch(
      outbox,
      /device_secret|credential\.secret|x-tindio-device-secret/i,
      "durable transaction outbox must not store device secrets",
    );
  },
);

test(
  "local payload application fails closed on organization/store mismatch",
  () => {
    const guard =
      read(
        "apps/mobile/src/features/security/local-scope-guard.ts",
      );

    const hub =
      read(
        "apps/mobile/src/db/store-hub-cache.ts",
      );

    const delta =
      read(
        "apps/mobile/src/db/delta-apply.ts",
      );

    assert.ok(
      guard.includes(
        "LOCAL_TENANT_SCOPE_MISMATCH",
      )
      && guard.includes(
        "LOCAL_STORE_SCOPE_MISMATCH",
      ),
    );

    assert.ok(
      hub.includes(
        "assertOrganizationScope",
      )
      && hub.includes(
        "assertStoreScope",
      ),
    );

    assert.ok(
      delta.includes(
        "assertStoreScope",
      ),
      "catalog delta store mismatch must fail closed",
    );
  },
);

test(
  "client sync schema does not accept a client-controlled employee identity",
  () => {
    const syncService =
      read(
        "src/features/offline/pos-v2-sync-service.ts",
      );

    assert.doesNotMatch(
      syncService,
      /employeeId\s*:/,
      "employee identity must come from authenticated BusinessContext, not sync payload",
    );
  },
);