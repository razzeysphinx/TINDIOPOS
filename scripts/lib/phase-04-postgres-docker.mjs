import {
  spawnSync,
} from "node:child_process";
import process from "node:process";

const POSTGRES_IMAGE =
  "postgres:18-alpine";

const MAX_BUFFER =
  1024
  * 1024
  * 1024;

function normalizedHostname(
  hostname,
) {
  return hostname
    .replace(
      /^\[/,
      "",
    )
    .replace(
      /\]$/,
      "",
    )
    .toLowerCase();
}

export function dockerReachablePostgresUrl(
  value,
) {
  const parsed =
    new URL(
      value,
    );

  const hostname =
    normalizedHostname(
      parsed.hostname,
    );

  const isHostLocal =
    hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1";

  if (!isHostLocal) {
    return {
      url:
        value,

      usesHostGateway:
        false,
    };
  }

  parsed.hostname =
    "host.docker.internal";

  return {
    url:
      parsed.toString(),

    usesHostGateway:
      true,
  };
}

function run({
  url,
  command,
  input,
  encoding,
  pgOptions,
}) {
  const reachable =
    dockerReachablePostgresUrl(
      url,
    );

  const dockerArgs = [
    "run",
    "--rm",
    "-i",
  ];

  // Docker Desktop resolves host.docker.internal automatically.
  // Native Linux Docker needs an explicit host-gateway alias.
  if (
    reachable
      .usesHostGateway
    && process.platform
      === "linux"
  ) {
    dockerArgs.push(
      "--add-host",
      "host.docker.internal:host-gateway",
    );
  }

  dockerArgs.push(
    "-e",
    "TINDIO_PGURL",
    POSTGRES_IMAGE,
    "sh",
    "-lc",
    command,
  );

  const result =
    spawnSync(
      "docker",
      dockerArgs,
      {
        env: {
          ...process.env,

          TINDIO_PGURL:
            reachable.url,

          ...(pgOptions
            ? { TINDIO_PGOPTIONS: pgOptions }
            : {}),
        },

        input,

        encoding,

        maxBuffer:
          MAX_BUFFER,
      },
    );

  if (
    result.error
    || result.status !== 0
  ) {
    const stderr =
      Buffer.isBuffer(
        result.stderr,
      )
        ? result.stderr
            .toString(
              "utf8",
            )
        : String(
            result.stderr
            ?? "",
          );

    throw new Error(
      stderr
      || `Docker Postgres command failed with exit code ${result.status}.`,
    );
  }

  return result.stdout;
}

export function runSql(
  url,
  sql,
) {
  return String(
    run({
      url,

      command:
        'psql "$TINDIO_PGURL" -X -q -A -t -v ON_ERROR_STOP=1',

      input:
        sql,

      encoding:
        "utf8",
    }),
  ).trim();
}

export function runReadOnlySql(
  url,
  sql,
) {
  return String(
    run({
      url,

      command:
        'PGOPTIONS="$TINDIO_PGOPTIONS" psql "$TINDIO_PGURL" -X -q -A -t -v ON_ERROR_STOP=1',

      input:
        `BEGIN TRANSACTION READ ONLY;\n${sql}\nROLLBACK;`,

      encoding:
        "utf8",

      pgOptions:
        "-c default_transaction_read_only=on -c statement_timeout=120000",
    }),
  ).trim();
}

export function restoreSql(
  url,
  sql,
) {
  run({
    url,

    command:
      'psql "$TINDIO_PGURL" -X -q -v ON_ERROR_STOP=1',

    input:
      sql,

    encoding:
      Buffer.isBuffer(
        sql,
      )
        ? null
        : "utf8",
  });
}

export function dumpBusinessData(
  url,
) {
  return run({
    url,

    command:
      'pg_dump "$TINDIO_PGURL" --data-only --schema=public --schema=private --no-owner --no-privileges',

    input:
      undefined,

    encoding:
      null,
  });
}

export function restoreSqlAtomic(
  url,
  sql,
) {
  run({
    url,

    command:
      'psql "$TINDIO_PGURL" -X -q -1 -v ON_ERROR_STOP=1',

    input:
      sql,

    encoding:
      Buffer.isBuffer(sql)
        ? null
        : "utf8",
  });
}

export function dumpBusinessDataReadOnly(
  url,
  extraArguments = [],
) {
  const safeArguments =
    extraArguments.map(
      (argument) => {
        if (!/^[A-Za-z0-9_.,=:-]+$/.test(argument)) {
          throw new Error(`Unsafe pg_dump argument: ${argument}`);
        }

        return argument;
      },
    );

  return run({
    url,

    command:
      [
        'PGOPTIONS="$TINDIO_PGOPTIONS" pg_dump "$TINDIO_PGURL"',
        "--data-only --no-owner --no-privileges",
        ...safeArguments,
      ].join(" "),

    input:
      undefined,

    encoding:
      null,

    pgOptions:
      "-c default_transaction_read_only=on -c statement_timeout=0",
  });
}
