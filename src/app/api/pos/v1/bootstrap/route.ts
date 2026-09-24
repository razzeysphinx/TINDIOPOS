import {
  randomUUID,
} from "node:crypto";

import type {
  PosBootstrapResponse,
} from "@/contracts/pos-v1";
import {
  loadPosWorkspace,
} from "@/features/pos/data";

import {
  getPosCapabilities,
} from "@/features/pos/pos-capabilities";

import {
  posApiJson,
} from "@/features/pos/pos-api-response";

import {
  hasPermission,
  type BusinessContext,
} from "@/lib/auth/dal";

import {
  getPosApiBusinessContext,
} from "@/lib/auth/pos-api-context";

const MAX_WORKSPACE_ATTEMPTS =
  2;

function sleep(
  milliseconds: number,
) {
  return new Promise<void>(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds,
      ),
  );
}

function safeErrorMessage(
  error: unknown,
) {
  if (
    error instanceof Error
  ) {
    return error.message
      .replace(
        /Bearer\s+[A-Za-z0-9._-]+/gi,
        "Bearer [REDACTED]",
      )
      .replace(
        /eyJ[A-Za-z0-9._-]+/g,
        "[REDACTED_TOKEN]",
      )
      .slice(0, 500);
  }

  return "Unknown bootstrap failure.";
}

async function loadWorkspaceWithRetry(
  context: BusinessContext,
  requestId: string,
) {
  let lastError:
    unknown = null;

  for (
    let attempt = 1;
    attempt
      <= MAX_WORKSPACE_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return {
        workspace:
          await loadPosWorkspace(
            context,
          ),

        attempts:
          attempt,
      };
    } catch (error) {
      lastError =
        error;

      console.warn(
        "POS bootstrap workspace read failed",
        {
          requestId,
          attempt,
          message:
            safeErrorMessage(
              error,
            ),
        },
      );

      if (
        attempt
        < MAX_WORKSPACE_ATTEMPTS
      ) {
        await sleep(
          200 * attempt,
        );
      }
    }
  }

  throw lastError
    ?? new Error(
      "POS bootstrap failed without an error.",
    );
}

export async function GET(
  request: Request,
) {
  const requestId =
    randomUUID();

  try {
    const context =
      await getPosApiBusinessContext(
        request,
      );

    if (!context) {
      const response =
        posApiJson(
          {
            ok: false,
            message:
              "Sign in is required.",
          },
          401,
        );

      response.headers.set(
        "x-tindio-request-id",
        requestId,
      );

      return response;
    }

    if (
      !hasPermission(
        context,
        "pos.access",
      )
      || !hasPermission(
        context,
        "sales.create",
      )
    ) {
      const response =
        posApiJson(
          {
            ok: false,
            message:
              "POS access is not permitted.",
          },
          403,
        );

      response.headers.set(
        "x-tindio-request-id",
        requestId,
      );

      return response;
    }

    const {
      workspace,
      attempts,
    } =
      await loadWorkspaceWithRetry(
        context,
        requestId,
      );

    const capabilities =
      getPosCapabilities({
        businessType:
          context.organization
            .business_type,

        features:
          context.features,

        permissions:
          context.permissions,
      });

    const response: PosBootstrapResponse = {
        organization: {
          id:
            context.organization.id,

          name:
            context.organization.name,

          currencyCode:
            context.organization
              .currency_code,

          timezone:
            context.organization
              .timezone,

          businessType:
            context.organization
              .business_type,

          deviceManagementEnabled:
            context.organization
              .device_management_enabled,
        },

        employee: {
          id:
            context.employee.id,

          employeeNumber:
            context.employee
              .employee_number,

          name:
            context.profile
              .full_name
            || context.profile
              .email
            || context.employee
              .employee_number,
        },

        availableOrganizations:
          context.availableOrganizations.map(
            ({
              id,
              name,
              status,
            }) => ({
              id,
              name,
              status,
            }),
          ),

        capabilities,

        offlineScope:
          `${context.organization.id}:${context.user.id}`,

        workspace,
      };

    const jsonResponse =
      posApiJson(
        response,
      );

    jsonResponse.headers.set(
      "x-tindio-request-id",
      requestId,
    );

    jsonResponse.headers.set(
      "x-tindio-bootstrap-attempts",
      String(attempts),
    );

    return jsonResponse;
  } catch (error) {
    console.error(
      "POS bootstrap failed",
      {
        requestId,

        message:
          safeErrorMessage(
            error,
          ),
      },
    );

    const response =
      posApiJson(
        {
          ok: false,

          message:
            "The POS could not be opened. Please try again.",

          requestId,
        },
        500,
      );

    response.headers.set(
      "x-tindio-request-id",
      requestId,
    );

    return response;
  }
}
