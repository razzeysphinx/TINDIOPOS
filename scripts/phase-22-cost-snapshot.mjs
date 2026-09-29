import {
  mkdirSync,
  writeFileSync,
} from "node:fs";
import process from "node:process";

import {
  runSql,
} from "./lib/phase-04-postgres-docker.mjs";

function required(name) {
  const value =
    process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `${name} is required.`,
    );
  }

  return value;
}

function safeJsonQuery(
  databaseUrl,
  sql,
) {
  return JSON.parse(
    runSql(
      databaseUrl,
      sql,
    ),
  );
}

const databaseUrl =
  required(
    "DATABASE_URL_UNPOOLED",
  );

const label =
  process.argv[2]
  ?.trim()
  || "snapshot";

const database =
  safeJsonQuery(
    databaseUrl,
    `
select to_jsonb(snapshot)::text
from (
  select
    current_database() as database_name,
    numbackends,
    xact_commit,
    xact_rollback,
    blks_read,
    blks_hit,
    tup_returned,
    tup_fetched,
    tup_inserted,
    tup_updated,
    tup_deleted,
    temp_files,
    temp_bytes
  from pg_stat_database
  where datname = current_database()
) snapshot;
`,
  );

const tables =
  safeJsonQuery(
    databaseUrl,
    `
select coalesce(
  jsonb_agg(
    to_jsonb(snapshot)
    order by snapshot.schema_name,
             snapshot.table_name
  ),
  '[]'::jsonb
)::text
from (
  select
    schemaname as schema_name,
    relname as table_name,
    seq_scan,
    seq_tup_read,
    idx_scan,
    idx_tup_fetch,
    n_tup_ins,
    n_tup_upd,
    n_tup_del
  from pg_stat_user_tables
) snapshot;
`,
  );

const extension =
  safeJsonQuery(
    databaseUrl,
    `
select jsonb_build_object(
  'available',
  exists (
    select 1
    from pg_extension
    where extname =
      'pg_stat_statements'
  )
)::text;
`,
  );

let statements = [];

if (extension.available) {
  try {
    statements =
      safeJsonQuery(
        databaseUrl,
        `
select coalesce(
  jsonb_agg(
    to_jsonb(snapshot)
    order by snapshot.total_exec_time desc
  ),
  '[]'::jsonb
)::text
from (
  select
    queryid::text
      as query_id,
    calls,
    total_exec_time,
    mean_exec_time,
    rows,
    left(
      regexp_replace(
        query,
        '\\s+',
        ' ',
        'g'
      ),
      300
    ) as query
  from public.pg_stat_statements
  where dbid = (
    select oid
    from pg_database
    where datname =
      current_database()
  )
  order by total_exec_time desc
  limit 500
) snapshot;
`,
      );
  } catch {
    statements = [];
  }
}

const connections =
  safeJsonQuery(
    databaseUrl,
    `
select jsonb_build_object(
  'total',
  count(*),
  'active',
  count(*) filter (
    where state = 'active'
  ),
  'idle',
  count(*) filter (
    where state = 'idle'
  )
)::text
from pg_stat_activity
where datname =
  current_database();
`,
  );

const report = {
  phase: 22,
  label,
  capturedAt:
    new Date()
      .toISOString(),
  database,
  connections,
  tables,
  pgStatStatements: {
    available:
      extension.available
      && statements.length > 0,
    statements,
  },
};

mkdirSync(
  "docs/mobile-program/evidence",
  {
    recursive: true,
  },
);

const path =
  `docs/mobile-program/evidence/PHASE_22_COST_${label.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;

writeFileSync(
  path,
  `${JSON.stringify(
    report,
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(path);