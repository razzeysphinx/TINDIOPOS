const QUANTITY_EPSILON =
  1e-9;

function inventoryKey(
  row,
) {
  return [
    row.organization_id,
    row.store_id,
    row.product_id,
    row.variant_id
      ?? "<simple>",
  ].join(
    ":",
  );
}

function numericValue(
  value,
) {
  const parsed =
    Number(
      value,
    );

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : null;
}

function sameQuantity(
  left,
  right,
) {
  return (
    Math.abs(
      left
      - right,
    )
    <= QUANTITY_EPSILON
  );
}

function anomaly(
  type,
  key,
  details = {},
) {
  return {
    type,
    key,
    ...details,
  };
}

export function reconcileInventoryState({
  levels,
  movements,
}) {
  if (
    !Array.isArray(levels)
    || !Array.isArray(movements)
  ) {
    throw new TypeError(
      "levels and movements must be arrays.",
    );
  }

  const anomalies = [];

  const levelsByKey =
    new Map();

  const movementsByKey =
    new Map();

  for (
    const level
    of levels
  ) {
    const key =
      inventoryKey(
        level,
      );

    if (
      levelsByKey.has(key)
    ) {
      anomalies.push(
        anomaly(
          "duplicate_projection_key",
          key,
        ),
      );

      continue;
    }

    const quantity =
      numericValue(
        level.quantity,
      );

    if (
      quantity === null
    ) {
      anomalies.push(
        anomaly(
          "invalid_projection_quantity",
          key,
        ),
      );

      continue;
    }

    levelsByKey.set(
      key,
      {
        ...level,
        _quantity:
          quantity,
      },
    );
  }

  for (
    const movement
    of movements
  ) {
    const key =
      inventoryKey(
        movement,
      );

    const quantityBefore =
      numericValue(
        movement.quantity_before,
      );

    const quantityDelta =
      numericValue(
        movement.quantity_delta,
      );

    const quantityAfter =
      numericValue(
        movement.quantity_after,
      );

    if (
      quantityBefore === null
      || quantityDelta === null
      || quantityAfter === null
    ) {
      anomalies.push(
        anomaly(
          "invalid_ledger_quantity",
          key,
          {
            movementId:
              movement.id,
          },
        ),
      );

      continue;
    }

    if (
      !sameQuantity(
        quantityBefore
        + quantityDelta,
        quantityAfter,
      )
    ) {
      anomalies.push(
        anomaly(
          "movement_arithmetic_mismatch",
          key,
          {
            movementId:
              movement.id,
            quantityBefore,
            quantityDelta,
            quantityAfter,
          },
        ),
      );
    }

    const existing =
      movementsByKey.get(
        key,
      )
      ?? [];

    existing.push({
      ...movement,
      _quantityBefore:
        quantityBefore,
      _quantityDelta:
        quantityDelta,
      _quantityAfter:
        quantityAfter,
    });

    movementsByKey.set(
      key,
      existing,
    );
  }

  for (
    const [
      key,
      keyMovements,
    ]
    of movementsByKey
  ) {
    keyMovements.sort(
      (
        left,
        right,
      ) => {
        const leftTime =
          Date.parse(
            left.created_at,
          );

        const rightTime =
          Date.parse(
            right.created_at,
          );

        if (
          Number.isFinite(leftTime)
          && Number.isFinite(rightTime)
          && leftTime !== rightTime
        ) {
          return (
            leftTime
            - rightTime
          );
        }

        return String(
          left.id,
        ).localeCompare(
          String(
            right.id,
          ),
        );
      },
    );

    for (
      let index = 1;
      index
        < keyMovements.length;
      index += 1
    ) {
      const previous =
        keyMovements[
          index - 1
        ];

      const current =
        keyMovements[
          index
        ];

      if (
        !sameQuantity(
          previous
            ._quantityAfter,
          current
            ._quantityBefore,
        )
      ) {
        anomalies.push(
          anomaly(
            "ledger_chain_break",
            key,
            {
              previousMovementId:
                previous.id,
              currentMovementId:
                current.id,
              previousQuantityAfter:
                previous
                  ._quantityAfter,
              currentQuantityBefore:
                current
                  ._quantityBefore,
            },
          ),
        );
      }
    }

    const level =
      levelsByKey.get(
        key,
      );

    if (!level) {
      anomalies.push(
        anomaly(
          "ledger_key_missing_projection",
          key,
        ),
      );

      continue;
    }

    const latestMovement =
      keyMovements[
        keyMovements.length
        - 1
      ];

    if (
      !sameQuantity(
        latestMovement
          ._quantityAfter,
        level
          ._quantity,
      )
    ) {
      anomalies.push(
        anomaly(
          "projection_ledger_mismatch",
          key,
          {
            latestMovementId:
              latestMovement.id,
            ledgerQuantity:
              latestMovement
                ._quantityAfter,
            projectionQuantity:
              level
                ._quantity,
          },
        ),
      );
    }
  }

  for (
    const [
      key,
      level,
    ]
    of levelsByKey
  ) {
    if (
      !movementsByKey.has(
        key,
      )
      && !sameQuantity(
        level
          ._quantity,
        0,
      )
    ) {
      anomalies.push(
        anomaly(
          "nonzero_projection_without_ledger",
          key,
          {
            projectionQuantity:
              level
                ._quantity,
          },
        ),
      );
    }
  }

  const anomalyCounts =
    {};

  for (
    const item
    of anomalies
  ) {
    anomalyCounts[
      item.type
    ] =
      (
        anomalyCounts[
          item.type
        ]
        ?? 0
      )
      + 1;
  }

  return {
    ok:
      anomalies.length
      === 0,

    projectionKeyCount:
      levelsByKey.size,

    ledgerKeyCount:
      movementsByKey.size,

    movementCount:
      movements.length,

    anomalyCount:
      anomalies.length,

    anomalyCounts,

    anomalies,
  };
}
