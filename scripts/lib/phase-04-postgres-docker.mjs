import {
  spawnSync,
} from "node:child_process";
import process from "node:process";

const POSTGRES_IMAGE =
  "postgres:17-alpine";

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
