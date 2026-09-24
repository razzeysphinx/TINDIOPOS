import "server-only";

import {
  z,
} from "zod";

import {
  createFeatureSettings,
  isBusinessType,
} from "@/features/business-profile/business-features";
import {
  posApiJson,
} from "@/features/pos/pos-api-response";
import type {
  BusinessContext,
} from "@/lib/auth/dal";
import {
  getPosV2Core,
} from "@/lib/auth/pos-v2-context";

const coreSchema =
  z.object({
    profileId:
      z.uuid(),

    organization:
      z.object({
        id:
          z.uuid(),

        name:
          z.string(),

        currencyCode:
          z.string(),

        timezone:
          z.string(),

        status:
          z.enum([
            "active",
            "suspended",
            "archived",
          ]),

        businessType:
          z.string(),

        deviceManagementEnabled:
          z.boolean(),
      }),

    employee:
      z.object({
        id:
          z.uuid(),

        employeeNumber:
          z.string(),

        jobTitle:
          z.string()
            .nullable(),

        name:
          z.string(),
      }),

    availableOrganizations:
      z.array(
        z.object({
          id:
            z.uuid(),

          name:
            z.string(),

          status:
            z.enum([
              "active",
              "suspended",
              "archived",
            ]),
        }),
      ),

    roleNames:
      z.array(
        z.string(),
      ),

    permissions:
      z.array(
        z.string(),
      ),

    storeIds:
      z.array(
        z.uuid(),
      ),

    features:
      z.record(
        z.string(),
        z.boolean(),
      ),
  });

export type PosV2BusinessContextResult =
  | {
      ok: true;

      context:
        BusinessContext;
    }
  | {
      ok: false;

      response:
        Response;
    };

export async function getPosV2BusinessContext(
  request: Request,
): Promise<
  PosV2BusinessContextResult
> {
  const resolved =
    await getPosV2Core(
      request,
    );

  if (!resolved.ok) {
    return {
      ok: false,

      response:
        posApiJson(
          {
            ok: false,
            reason:
              resolved.reason,
          },
          resolved.status,
        ),
    };
  }

  const parsed =
    coreSchema.safeParse(
      resolved.core,
    );

  if (!parsed.success) {
    return {
      ok: false,

      response:
        posApiJson(
          {
            ok: false,
            reason:
              "INVALID_BUSINESS_CONTEXT",
          },
          503,
        ),
    };
  }

  const core =
    parsed.data;

  if (
    core.organization.status
    !== "active"
  ) {
    return {
      ok: false,

      response:
        posApiJson(
          {
            ok: false,
            reason:
              "ORGANIZATION_INACTIVE",
          },
          403,
        ),
    };
  }

  if (
    !isBusinessType(
      core.organization
        .businessType,
    )
  ) {
    return {
      ok: false,

      response:
        posApiJson(
          {
            ok: false,
            reason:
              "INVALID_BUSINESS_TYPE",
          },
          503,
        ),
    };
  }

  const features =
    createFeatureSettings(
      Object.entries(
        core.features,
      ).map(
        ([
          featureKey,
          isEnabled,
        ]) => ({
          featureKey,
          isEnabled,
        }),
      ),
    );

  const context:
    BusinessContext = {
      requestAuth: {
        transport:
          "bearer",

        authorizationHeader:
          resolved.auth
            .authorizationHeader,
      },

      user: {
        id:
          core.profileId,

        subject:
          resolved.auth
            .subject,

        email:
          resolved.auth
            .email,
      },

      profile: {
        full_name:
          core.employee.name,

        email:
          resolved.auth
            .email
          ?? "",
      },

      employee: {
        id:
          core.employee.id,

        employee_number:
          core.employee
            .employeeNumber,

        job_title:
          core.employee
            .jobTitle,

        organization_id:
          core.organization.id,

        status:
          "active",
      },

      organization: {
        id:
          core.organization.id,

        name:
          core.organization.name,

        currency_code:
          core.organization
            .currencyCode,

        timezone:
          core.organization
            .timezone,

        status:
          "active",

        suspended_at:
          null,

        suspension_reason:
          null,

        archive_requested_at:
          null,

        archived_at:
          null,

        business_type:
          core.organization
            .businessType,

        device_management_enabled:
          core.organization
            .deviceManagementEnabled,
      },

      availableOrganizations:
        core
          .availableOrganizations,

      tenantReadiness: {
        canExport:
          false,

        canManageLifecycle:
          false,

        canViewRecovery:
          false,

        canManageRecovery:
          false,
      },

      features,

      roleNames:
        core.roleNames,

      permissions:
        core.permissions,

      storeIds:
        core.storeIds,
    };

  return {
    ok: true,
    context,
  };
}
