import { secureStorage } from "../../lib/secure-storage";
import { isStoreHubTransportAllowed } from "./store-hub-transport-policy";
import {
  isStoreHubEnabledForRelease,
  STORE_HUB_DEFERRED_REASON,
} from "./store-hub-release-scope";

export type StoreHubConfig = {
  version: 1;
  organizationId: string;
  storeId: string;
  endpoint: string;
  token: string;
  configuredAt: string;
};

const key = (organizationId: string) =>
  `tindio.store-hub.config.${organizationId}`;

function privateIpv4(hostname: string) {
  const parts = hostname
    .split(".")
    .map((value) => Number(value));

  if (
    parts.length !== 4
    || parts.some(
      (value) =>
        !Number.isInteger(value)
        || value < 0
        || value > 255,
    )
  ) {
    return false;
  }

  return (
    parts[0] === 10
    || (
      parts[0] === 172
      && parts[1] >= 16
      && parts[1] <= 31
    )
    || (
      parts[0] === 192
      && parts[1] === 168
    )
    || (
      parts[0] === 127
    )
  );
}

function allowsInsecureDevelopmentHttp() {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

export function normalizeStoreHubEndpoint(
  value: string,
  options: {
    allowInsecureHttp?: boolean;
  } = {},
) {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (
    !isStoreHubTransportAllowed({
      protocol: url.protocol,
      allowInsecureHttp:
        options.allowInsecureHttp
        ?? allowsInsecureDevelopmentHttp(),
    })
  ) {
    return null;
  }

  const hostname = url.hostname.toLocaleLowerCase();

  const allowed =
    privateIpv4(hostname)
    || hostname === "localhost"
    || hostname.endsWith(".local");

  if (!allowed) return null;

  url.pathname = "/";
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/+$/, "");
}

export async function saveStoreHubConfig(input: {
  organizationId: string;
  storeId: string;
  endpoint: string;
  token: string;
}) {
  if (!isStoreHubEnabledForRelease()) {
    throw new Error(STORE_HUB_DEFERRED_REASON);
  }

  const endpoint = normalizeStoreHubEndpoint(input.endpoint);
  const token = input.token.trim();

  if (!endpoint) {
    try {
      const candidate = new URL(input.endpoint.trim());

      if (
        candidate.protocol === "http:"
        && !allowsInsecureDevelopmentHttp()
      ) {
        throw new Error("STORE_HUB_HTTPS_REQUIRED");
      }
    } catch (error) {
      if (
        error instanceof Error
        && error.message === "STORE_HUB_HTTPS_REQUIRED"
      ) {
        throw error;
      }
    }

    throw new Error("STORE_HUB_PRIVATE_ENDPOINT_REQUIRED");
  }

  if (token.length < 32) {
    throw new Error("STORE_HUB_TOKEN_TOO_SHORT");
  }

  const config: StoreHubConfig = {
    version: 1,
    organizationId: input.organizationId,
    storeId: input.storeId,
    endpoint,
    token,
    configuredAt: new Date().toISOString(),
  };

  await secureStorage.setItem(
    key(input.organizationId),
    JSON.stringify(config),
  );

  return config;
}

export async function readStoreHubConfig(
  organizationId: string,
) {
  if (!isStoreHubEnabledForRelease()) {
    return null;
  }

  const raw = await secureStorage.getItem(
    key(organizationId),
  );

  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as StoreHubConfig;

    if (
      value.version !== 1
      || value.organizationId !== organizationId
      || !normalizeStoreHubEndpoint(value.endpoint)
      || typeof value.token !== "string"
      || value.token.length < 32
    ) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
}

export async function clearStoreHubConfig(
  organizationId: string,
) {
  if (!isStoreHubEnabledForRelease()) {
    throw new Error(STORE_HUB_DEFERRED_REASON);
  }

  await secureStorage.removeItem(
    key(organizationId),
  );
}
