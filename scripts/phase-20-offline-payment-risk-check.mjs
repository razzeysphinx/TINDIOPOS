import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) =>
  fs.readFileSync(
    path,
    "utf8",
  );

test(
  "Phase 20 provider contract contains no forbidden card-data fields",
  () => {
    const provider =
      read(
        "apps/mobile/src/features/payments/offline-payment-provider.ts",
      );

    assert.doesNotMatch(
      provider,
      /\bpan\b|cardNumber|card_number|\bcvv\b|\bcvc\b|track1|track2|pinBlock|pin_block|expiry|cryptogram|rawNfc/i,
    );
  },
);

test(
  "Phase 20 electronic offline payments fail closed without a PSP",
  () => {
    const gate =
      read(
        "apps/mobile/src/features/payments/offline-electronic-payment-gate.ts",
      );

    const risk =
      read(
        "apps/mobile/src/features/payments/offline-payment-risk.ts",
      );

    assert.ok(
      gate.includes(
        "failClosedOfflineElectronicPolicy",
      )
      && gate.includes(
        '=== "STORE_AND_FORWARD"',
      )
      && risk.includes(
        "electronicOfflineAllowed: false",
      )
      && risk.includes(
        '"ELECTRONIC_OFFLINE_DISABLED"',
      ),
      "electronic offline payment must fail closed without an explicitly capable PSP",
    );
  },
);

test(
  "Phase 20 risk engine enforces transaction, exposure, duration, and manager thresholds",
  () => {
    const risk =
      read(
        "apps/mobile/src/features/payments/offline-payment-risk.ts",
      );

    for (
      const decision of [
        "TRANSACTION_LIMIT_EXCEEDED",
        "EXPOSURE_LIMIT_EXCEEDED",
        "OFFLINE_DURATION_EXCEEDED",
        "MANAGER_APPROVAL_REQUIRED",
        "ALLOW",
      ]
    ) {
      assert.ok(
        risk.includes(
          decision,
        ),
        `risk engine must preserve ${decision}`,
      );
    }
  },
);

test(
  "Phase 20 preserves cash-only durable offline sale path",
  () => {
    const offlineSale =
      read(
        "apps/mobile/src/features/outbox/create-offline-sale.ts",
      );

    const checkout =
      read(
        "src/features/checkout/checkout-service.ts",
      );

    assert.ok(
      offlineSale.includes(
        'method.type === "CASH"',
      )
      && offlineSale.includes(
        'method.offlinePolicy === "cash"',
      ),
      "mobile durable offline sale must remain cash-only",
    );

    assert.doesNotMatch(
      offlineSale,
      /STORE_AND_FORWARD|authorizeOffline|providerReference/,
      "electronic provider results must not be injected into cash outbox flow",
    );

    assert.ok(
      checkout.includes(
        'method.payment_type !== "CASH"',
      )
      && checkout.includes(
        'method.offline_policy !== "cash"',
      ),
      "server offline reconciliation must keep validating cash policy",
    );
  },
);

test(
  "Phase 20 provider registry accepts only explicit store-and-forward adapters",
  () => {
    const registry =
      read(
        "apps/mobile/src/features/payments/offline-payment-provider-registry.ts",
      );

    assert.ok(
      registry.includes(
        'adapter.capability',
      )
      && registry.includes(
        '"STORE_AND_FORWARD"',
      ),
    );

    assert.doesNotMatch(
      registry,
      /registerOfflinePaymentProvider\([\s\S]*providerCode:\s*["']/,
      "Phase 20 must not register a fake provider",
    );
  },
);
