import assert from "node:assert/strict";
import test from "node:test";

function makeEvent({
  organizationId = "org-a",
  deviceId = "device-a",
  sequence = 1,
  idempotencyKey = `idem-${sequence}`,
} = {}) {
  return {
    eventId: `event-${idempotencyKey}`,
    organizationId,
    deviceId,
    deviceSequence: sequence,
    idempotencyKey,
    localReference: `OFF-${String(sequence).padStart(6, "0")}`,
    totalMinor: 1000,
    quantityDelta: -1,
  };
}

class DeterministicServer {
  constructor(organizationId = "org-a") {
    this.organizationId = organizationId;
    this.checkpoints = new Map();
    this.sequenceReceipts = new Map();
    this.idempotencyReceipts = new Map();
    this.sales = new Map();
    this.payments = new Map();
    this.stockMovements = new Map();
    this.receipts = new Map();
  }

  checkpoint(deviceId) {
    return this.checkpoints.get(deviceId) ?? 0;
  }

  snapshot() {
    return {
      sales: this.sales.size,
      payments: this.payments.size,
      stockMovements: this.stockMovements.size,
      receipts: this.receipts.size,
    };
  }

  push(event, options = {}) {
    if (event.organizationId !== this.organizationId) {
      return {
        ok: false,
        retryable: false,
        code: "TENANT_MISMATCH",
      };
    }

    const existingByIdempotency =
      this.idempotencyReceipts.get(
        event.idempotencyKey,
      );

    if (existingByIdempotency) {
      return {
        ok: true,
        replay: true,
        result: existingByIdempotency,
      };
    }

    const checkpoint =
      this.checkpoint(event.deviceId);

    const sequenceKey =
      `${event.deviceId}:${event.deviceSequence}`;

    const existingSequence =
      this.sequenceReceipts.get(
        sequenceKey,
      );

    if (
      existingSequence
      && existingSequence
        !== event.idempotencyKey
    ) {
      return {
        ok: false,
        retryable: false,
        code: "DUPLICATE_SEQUENCE",
        checkpoint,
      };
    }

    if (
      event.deviceSequence
      > checkpoint + 1
    ) {
      return {
        ok: false,
        retryable: false,
        code: "SEQUENCE_GAP",
        checkpoint,
        expectedSequence:
          checkpoint + 1,
      };
    }

    if (
      event.deviceSequence
      < checkpoint + 1
    ) {
      return {
        ok: false,
        retryable: false,
        code: "SEQUENCE_OUT_OF_ORDER",
        checkpoint,
        expectedSequence:
          checkpoint + 1,
      };
    }

    if (
      options.networkLossBeforeCommit
      || options.apiOutage
      || options.databaseOutage
    ) {
      return {
        ok: false,
        retryable: true,
        code: "TRANSPORT_RETRY",
      };
    }

    if (
      options.expiredToken
      || options.revokedEmployee
      || options.revokedDevice
    ) {
      return {
        ok: false,
        retryable: false,
        code:
          options.revokedDevice
            ? "DEVICE_REVOKED"
            : "AUTHORIZATION_CHANGED",
      };
    }

    if (options.closedShift) {
      return {
        ok: false,
        retryable: false,
        code: "CLOSED_SHIFT",
      };
    }

    if (options.changedPrice) {
      return {
        ok: false,
        retryable: false,
        code: "PRICE_CHANGED",
      };
    }

    if (options.changedTax) {
      return {
        ok: false,
        retryable: false,
        code: "TAX_CHANGED",
      };
    }

    if (options.stockConflict) {
      return {
        ok: false,
        retryable: false,
        code: "INVENTORY_CONFLICT",
      };
    }

    const saleId =
      `sale-${event.idempotencyKey}`;

    const paymentId =
      `payment-${event.idempotencyKey}`;

    const stockMovementId =
      `stock-${event.idempotencyKey}`;

    const receiptId =
      `receipt-${event.idempotencyKey}`;

    const result = {
      saleId,
      paymentId,
      stockMovementId,
      receiptId,
      idempotencyKey:
        event.idempotencyKey,
      deviceSequence:
        event.deviceSequence,
    };

    // This block models ONE authoritative atomic commit.
    this.sales.set(
      saleId,
      result,
    );
    this.payments.set(
      paymentId,
      result,
    );
    this.stockMovements.set(
      stockMovementId,
      result,
    );
    this.receipts.set(
      receiptId,
      result,
    );

    this.sequenceReceipts.set(
      sequenceKey,
      event.idempotencyKey,
    );

    this.idempotencyReceipts.set(
      event.idempotencyKey,
      result,
    );

    this.checkpoints.set(
      event.deviceId,
      event.deviceSequence,
    );

    if (
      options.networkLossAfterCommit
      || options.missingAck
    ) {
      return {
        ok: false,
        retryable: true,
        code: "ACK_LOST_AFTER_COMMIT",
      };
    }

    return {
      ok: true,
      replay: false,
      result,
    };
  }
}

function recoverKilledLocalEvent(event) {
  return {
    ...event,
    state:
      event.state === "SYNCING"
        ? "LOCAL_PENDING"
        : event.state,
  };
}

function rebootRoundTrip(queue) {
  return JSON.parse(
    JSON.stringify(queue),
  );
}

function runQueue(count) {
  const server =
    new DeterministicServer();

  for (
    let sequence = 1;
    sequence <= count;
    sequence += 1
  ) {
    const result =
      server.push(
        makeEvent({ sequence }),
      );

    assert.equal(
      result.ok,
      true,
      `sequence ${sequence} must commit`,
    );
  }

  return server;
}

test(
  "network loss before commit leaves no partial money or stock and retry commits once",
  () => {
    const server =
      new DeterministicServer();

    const event =
      makeEvent();

    const lost =
      server.push(
        event,
        {
          networkLossBeforeCommit: true,
        },
      );

    assert.equal(
      lost.retryable,
      true,
    );

    assert.deepEqual(
      server.snapshot(),
      {
        sales: 0,
        payments: 0,
        stockMovements: 0,
        receipts: 0,
      },
    );

    const retry =
      server.push(event);

    assert.equal(
      retry.ok,
      true,
    );

    assert.deepEqual(
      server.snapshot(),
      {
        sales: 1,
        payments: 1,
        stockMovements: 1,
        receipts: 1,
      },
    );
  },
);

test(
  "network loss after commit or missing ACK replays the same transaction without duplicate money or stock",
  () => {
    for (
      const failure of [
        "networkLossAfterCommit",
        "missingAck",
      ]
    ) {
      const server =
        new DeterministicServer();

      const event =
        makeEvent();

      const first =
        server.push(
          event,
          {
            [failure]: true,
          },
        );

      assert.equal(
        first.retryable,
        true,
      );

      assert.deepEqual(
        server.snapshot(),
        {
          sales: 1,
          payments: 1,
          stockMovements: 1,
          receipts: 1,
        },
      );

      const retry =
        server.push(event);

      assert.equal(
        retry.ok,
        true,
      );

      assert.equal(
        retry.replay,
        true,
      );

      assert.deepEqual(
        server.snapshot(),
        {
          sales: 1,
          payments: 1,
          stockMovements: 1,
          receipts: 1,
        },
      );
    }
  },
);

test(
  "duplicate retry uses one stable idempotency identity",
  () => {
    const server =
      new DeterministicServer();

    const event =
      makeEvent();

    assert.equal(
      server.push(event).ok,
      true,
    );

    for (
      let attempt = 0;
      attempt < 10;
      attempt += 1
    ) {
      const replay =
        server.push(event);

      assert.equal(
        replay.ok,
        true,
      );

      assert.equal(
        replay.replay,
        true,
      );
    }

    assert.deepEqual(
      server.snapshot(),
      {
        sales: 1,
        payments: 1,
        stockMovements: 1,
        receipts: 1,
      },
    );
  },
);

test(
  "out-of-order and missing sequence are detected before mutation",
  () => {
    const server =
      new DeterministicServer();

    const second =
      server.push(
        makeEvent({
          sequence: 2,
        }),
      );

    assert.equal(
      second.code,
      "SEQUENCE_GAP",
    );

    assert.deepEqual(
      server.snapshot(),
      {
        sales: 0,
        payments: 0,
        stockMovements: 0,
        receipts: 0,
      },
    );

    assert.equal(
      server.push(
        makeEvent({
          sequence: 1,
        }),
      ).ok,
      true,
    );

    const third =
      server.push(
        makeEvent({
          sequence: 3,
        }),
      );

    assert.equal(
      third.code,
      "SEQUENCE_GAP",
    );

    assert.equal(
      server.checkpoint(
        "device-a",
      ),
      1,
    );
  },
);

test(
  "app kill during SYNCING recovers the same durable identity to LOCAL_PENDING",
  () => {
    const original = {
      ...makeEvent(),
      state: "SYNCING",
    };

    const recovered =
      recoverKilledLocalEvent(
        original,
      );

    assert.equal(
      recovered.state,
      "LOCAL_PENDING",
    );

    assert.equal(
      recovered.eventId,
      original.eventId,
    );

    assert.equal(
      recovered.idempotencyKey,
      original.idempotencyKey,
    );

    assert.equal(
      recovered.deviceSequence,
      original.deviceSequence,
    );
  },
);

test(
  "phone reboot preserves queued transaction identity",
  () => {
    const queue = [
      {
        ...makeEvent(),
        state: "LOCAL_PENDING",
      },
    ];

    const restored =
      rebootRoundTrip(queue);

    assert.deepEqual(
      restored,
      queue,
    );
  },
);

test(
  "API and database outage remain retryable without mutation",
  () => {
    for (
      const option of [
        "apiOutage",
        "databaseOutage",
      ]
    ) {
      const server =
        new DeterministicServer();

      const result =
        server.push(
          makeEvent(),
          {
            [option]: true,
          },
        );

      assert.equal(
        result.retryable,
        true,
      );

      assert.deepEqual(
        server.snapshot(),
        {
          sales: 0,
          payments: 0,
          stockMovements: 0,
          receipts: 0,
        },
      );
    }
  },
);

test(
  "authorization and business-rule conflicts never become silent commits",
  () => {
    const cases = [
      [
        "expiredToken",
        "AUTHORIZATION_CHANGED",
      ],
      [
        "revokedEmployee",
        "AUTHORIZATION_CHANGED",
      ],
      [
        "revokedDevice",
        "DEVICE_REVOKED",
      ],
      [
        "closedShift",
        "CLOSED_SHIFT",
      ],
      [
        "changedPrice",
        "PRICE_CHANGED",
      ],
      [
        "changedTax",
        "TAX_CHANGED",
      ],
      [
        "stockConflict",
        "INVENTORY_CONFLICT",
      ],
    ];

    for (
      const [option, expectedCode]
      of cases
    ) {
      const server =
        new DeterministicServer();

      const result =
        server.push(
          makeEvent(),
          {
            [option]: true,
          },
        );

      assert.equal(
        result.ok,
        false,
      );

      assert.equal(
        result.retryable,
        false,
      );

      assert.equal(
        result.code,
        expectedCode,
      );

      assert.deepEqual(
        server.snapshot(),
        {
          sales: 0,
          payments: 0,
          stockMovements: 0,
          receipts: 0,
        },
      );
    }
  },
);

test(
  "cross-tenant operation is rejected without leaking or mutating data",
  () => {
    const server =
      new DeterministicServer(
        "org-a",
      );

    const result =
      server.push(
        makeEvent({
          organizationId:
            "org-b",
        }),
      );

    assert.equal(
      result.code,
      "TENANT_MISMATCH",
    );

    assert.deepEqual(
      server.snapshot(),
      {
        sales: 0,
        payments: 0,
        stockMovements: 0,
        receipts: 0,
      },
    );
  },
);

test(
  "100 queued operations drain exactly once",
  () => {
    const server =
      runQueue(100);

    assert.deepEqual(
      server.snapshot(),
      {
        sales: 100,
        payments: 100,
        stockMovements: 100,
        receipts: 100,
      },
    );

    assert.equal(
      server.checkpoint(
        "device-a",
      ),
      100,
    );
  },
);

test(
  "1000 queued operations drain exactly once",
  () => {
    const server =
      runQueue(1000);

    assert.deepEqual(
      server.snapshot(),
      {
        sales: 1000,
        payments: 1000,
        stockMovements: 1000,
        receipts: 1000,
      },
    );

    assert.equal(
      server.checkpoint(
        "device-a",
      ),
      1000,
    );
  },
);
