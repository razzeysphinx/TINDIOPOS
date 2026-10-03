import {
  readFileSync,
} from "node:fs";

const [
  beforePath,
  afterPath,
] = process.argv.slice(2);

if (
  !beforePath
  || !afterPath
) {
  throw new Error(
    "Usage: node scripts/phase-22-cost-diff.mjs <before.json> <after.json>",
  );
}

const before =
  JSON.parse(
    readFileSync(
      beforePath,
      "utf8",
    ),
  );

const after =
  JSON.parse(
    readFileSync(
      afterPath,
      "utf8",
    ),
  );

const numericDelta = (
  left,
  right,
) =>
  Number(right ?? 0)
  - Number(left ?? 0);

const database = {};

for (
  const key of [
    "xact_commit",
    "xact_rollback",
    "blks_read",
    "blks_hit",
    "tup_returned",
    "tup_fetched",
    "tup_inserted",
    "tup_updated",
    "tup_deleted",
    "temp_files",
    "temp_bytes",
  ]
) {
  database[key] =
    numericDelta(
      before.database?.[key],
      after.database?.[key],
    );
}

const beforeTables =
  new Map(
    (before.tables ?? [])
      .map(
        (row) => [
          `${row.schema_name}.${row.table_name}`,
          row,
        ],
      ),
  );

const tables =
  (after.tables ?? [])
    .map((row) => {
      const previous =
        beforeTables.get(
          `${row.schema_name}.${row.table_name}`,
        )
        ?? {};

      return {
        table:
          `${row.schema_name}.${row.table_name}`,

        seq_scan:
          numericDelta(
            previous.seq_scan,
            row.seq_scan,
          ),

        seq_tup_read:
          numericDelta(
            previous.seq_tup_read,
            row.seq_tup_read,
          ),

        idx_scan:
          numericDelta(
            previous.idx_scan,
            row.idx_scan,
          ),

        idx_tup_fetch:
          numericDelta(
            previous.idx_tup_fetch,
            row.idx_tup_fetch,
          ),

        inserted:
          numericDelta(
            previous.n_tup_ins,
            row.n_tup_ins,
          ),

        updated:
          numericDelta(
            previous.n_tup_upd,
            row.n_tup_upd,
          ),

        deleted:
          numericDelta(
            previous.n_tup_del,
            row.n_tup_del,
          ),
      };
    })
    .filter(
      (row) =>
        Object.entries(row)
          .some(
            ([key, value]) =>
              key !== "table"
              && Number(value) !== 0,
          ),
    );

const beforeStatements =
  new Map(
    (
      before
        .pgStatStatements
        ?.statements
      ?? []
    ).map(
      (row) => [
        row.query_id,
        row,
      ],
    ),
  );

const statements =
  (
    after
      .pgStatStatements
      ?.statements
    ?? []
  )
    .map((row) => {
      const previous =
        beforeStatements.get(
          row.query_id,
        )
        ?? {};

      return {
        queryId:
          row.query_id,

        calls:
          numericDelta(
            previous.calls,
            row.calls,
          ),

        totalExecTimeMs:
          numericDelta(
            previous.total_exec_time,
            row.total_exec_time,
          ),

        rows:
          numericDelta(
            previous.rows,
            row.rows,
          ),

        meanExecTimeMs:
          Number(
            row.mean_exec_time
            ?? 0,
          ),

        query:
          row.query,
      };
    })
    .filter(
      (row) =>
        row.calls > 0
        || row.totalExecTimeMs > 0,
    )
    .sort(
      (left, right) =>
        right.totalExecTimeMs
        - left.totalExecTimeMs,
    );

console.log(
  JSON.stringify(
    {
      phase: 22,

      before:
        before.label,

      after:
        after.label,

      database,

      connections: {
        before:
          before.connections,
        after:
          after.connections,
      },

      tableActivity:
        tables,

      statementActivity:
        statements,
    },
    null,
    2,
  ),
);