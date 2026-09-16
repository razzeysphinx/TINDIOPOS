import "server-only";

import { randomUUID } from "node:crypto";

import type { createClient } from "@/lib/supabase/server";

export const INVENTORY_SCHEMA_CONTRACT_VERSION = 2;

export type InventorySchemaModule =
  | "count_batches"
  | "direct_transfers"
  | "purchasing"
  | "valuation"
  | "replenishment";

export type InventorySchemaModules =
  Record<InventorySchemaModule, boolean>;

export type InventorySchemaContract =
  | {
      status: "ready";
      contractVersion: number;
      modules: InventorySchemaModules;
    }
  | {
      status: "outdated";
      reason:
        | "RPC_MISSING"
        | "VERSION_BEHIND"
        | "CORE_MISSING";
      contractVersion: number | null;
      missingCore: string[];
      modules: InventorySchemaModules;
    };

type ServerSupabaseClient =
  Awaited<ReturnType<typeof createClient>>;

type RpcError = {
  code?: string;
  message?: string;
};

type RawRpcResult = {
  data: unknown;
  error: RpcError | null;
};

type InventorySchemaRpcClient = {
  rpc(
    name: "get_inventory_schema_contract",
    args: {
      target_organization_id: string;
    },
  ): PromiseLike<RawRpcResult>;
};

const EMPTY_MODULES: InventorySchemaModules = {
  count_batches: false,
  direct_transfers: false,
  purchasing: false,
  valuation: false,
  replenishment: false,
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value);
}

function parseModules(
  value: unknown,
): InventorySchemaModules {
  if (!isRecord(value)) {
    return { ...EMPTY_MODULES };
  }

  return {
    count_batches: value.count_batches === true,
    direct_transfers: value.direct_transfers === true,
    purchasing: value.purchasing === true,
    valuation: value.valuation === true,
    replenishment: value.replenishment === true,
  };
}

function parseMissingCore(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (entry): entry is string =>
      typeof entry === "string",
  );
}

function isMissingContractRpc(error: RpcError) {
  return error.code === "PGRST202"
    || error.code === "42883"
    || (
      error.message?.includes(
        "get_inventory_schema_contract",
      ) === true
      && error.message.includes("schema cache")
    );
}

export async function loadInventorySchemaContract(
  supabase: ServerSupabaseClient,
  organizationId: string,
): Promise<InventorySchemaContract> {
  const client =
    supabase as unknown as InventorySchemaRpcClient;

  const { data, error } = await client.rpc(
    "get_inventory_schema_contract",
    {
      target_organization_id: organizationId,
    },
  );

  if (error) {
    if (isMissingContractRpc(error)) {
      return {
        status: "outdated",
        reason: "RPC_MISSING",
        contractVersion: null,
        missingCore: [],
        modules: { ...EMPTY_MODULES },
      };
    }

    throw new Error(
      `Unable to verify inventory schema compatibility: ${
        error.code ?? "UNKNOWN"
      }`,
    );
  }

  if (!isRecord(data)) {
    throw new Error(
      "Inventory schema contract returned an invalid response.",
    );
  }

  const contractVersion =
    typeof data.contract_version === "number"
      ? data.contract_version
      : null;

  const modules = parseModules(data.modules);
  const missingCore =
    parseMissingCore(data.core_missing);

  if (
    contractVersion === null
    || contractVersion
      < INVENTORY_SCHEMA_CONTRACT_VERSION
  ) {
    return {
      status: "outdated",
      reason: "VERSION_BEHIND",
      contractVersion,
      missingCore,
      modules,
    };
  }

  if (
    data.core_ready !== true
    || missingCore.length > 0
  ) {
    return {
      status: "outdated",
      reason: "CORE_MISSING",
      contractVersion,
      missingCore,
      modules,
    };
  }

  return {
    status: "ready",
    contractVersion,
    modules,
  };
}

export type InventoryModuleFailure = {
  incidentId: string;
  module: string;
};

export function reportInventoryModuleFailure(
  module: string,
  error: RpcError,
): InventoryModuleFailure {
  const incidentId = randomUUID();

  console.error("Inventory module query failed", {
    incidentId,
    module,
    code: error.code ?? null,
    message: error.message ?? "Unknown inventory error",
  });

  return {
    incidentId,
    module,
  };
}
