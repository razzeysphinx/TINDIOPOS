const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

const REQUIRED_SERVICE_PROTOCOLS = new Map([
  ["API_URL", new Set(["http:", "https:"])],
  ["DB_URL", new Set(["postgres:", "postgresql:"])],
]);

function parseServiceUrl(
  field,
  value,
  allowedProtocols = null,
) {
  if (
    typeof value !== "string"
    || value.trim() === ""
  ) {
    throw new Error(
      `Supabase status ${field} must be a non-empty string.`,
    );
  }

  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `Supabase status ${field} is not a valid URL.`,
    );
  }

  if (
    allowedProtocols
    && !allowedProtocols.has(
      parsed.protocol,
    )
  ) {
    throw new Error(
      `Supabase status ${field} uses an unsupported protocol.`,
    );
  }

  if (
    !LOCAL_HOSTS.has(
      parsed.hostname.toLowerCase(),
    )
  ) {
    throw new Error(
      `Supabase status ${field} resolved a non-local host.`,
    );
  }

  return {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port,
  };
}

export function parseAndValidateLocalSupabaseStatus(
  output,
) {
  if (
    typeof output !== "string"
    || output.trim() === ""
  ) {
    throw new Error(
      "Supabase status did not return JSON output.",
    );
  }

  let status;

  try {
    status = JSON.parse(output);
  } catch {
    throw new Error(
      "Supabase status did not return unambiguous JSON.",
    );
  }

  if (
    status === null
    || Array.isArray(status)
    || typeof status !== "object"
  ) {
    throw new Error(
      "Supabase status did not return a service object.",
    );
  }

  const validated = {};

  for (
    const [field, protocols]
    of REQUIRED_SERVICE_PROTOCOLS
  ) {
    if (
      !Object.prototype
        .hasOwnProperty
        .call(
          status,
          field,
        )
    ) {
      throw new Error(
        `Supabase status is missing required ${field}.`,
      );
    }

    validated[field] =
      parseServiceUrl(
        field,
        status[field],
        protocols,
      );
  }

  /*
   * Preserve the previous fail-closed behavior for any additional service
   * URL strings emitted by the CLI. Critical API_URL and DB_URL are already
   * required and protocol-checked above.
   */
  for (
    const [field, value]
    of Object.entries(status)
  ) {
    if (
      REQUIRED_SERVICE_PROTOCOLS.has(field)
      || !field.endsWith("_URL")
      || typeof value !== "string"
    ) {
      continue;
    }

    parseServiceUrl(
      field,
      value,
    );
  }

  return validated;
}
