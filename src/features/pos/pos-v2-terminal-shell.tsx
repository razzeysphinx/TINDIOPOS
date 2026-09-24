"use client";

import {
  AlertTriangle,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  useRouter,
} from "next/navigation";

import type {
  PosBootstrapV2CoreResponse,
  PosLiveV2Response,
  PosReferenceV2Response,
} from "@/contracts/pos-v1";
import {
  Button,
} from "@/components/ui/button";
import {
  createFeatureSettings,
} from "@/features/business-profile/business-features";
import {
  getCachedPosV2Reference,
  cachePosV2Reference,
} from "@/features/offline/offline-store";
import {
  fetchPosV2Core,
  fetchPosV2Live,
  fetchPosV2Reference,
  PosV2ApiError,
} from "@/features/pos/pos-v2-browser-api";
import {
  canAccessBackOfficeV2,
} from "@/features/pos/pos-v2-client-access";
import {
  getPosCapabilities,
} from "@/features/pos/pos-capabilities";
import {
  PosTerminal,
} from "@/features/pos/pos-terminal";

const EMPTY_REFERENCE:
  PosReferenceV2Response["reference"] = {
    categories: [],
    paymentMethods: [],
    loyaltyProgram: null,
    discounts: [],
    taxRates: [],
    diningOptions: [],
    ticketTemplates: [],
  };

const EMPTY_LIVE:
  PosLiveV2Response["live"] = {
    timeClockEntry: null,
    customerDisplaySessions: [],
    canReceiveIncomingTransfers: false,
    incomingTransfers: [],
    openTickets: [],
    ticketAssignees: [],
  };

type PosV2Core =
  PosBootstrapV2CoreResponse["core"];

type StartupError = {
  requestId: string | null;
};

type ReferenceState =
  | "idle"
  | "loading"
  | "ready"
  | "cached"
  | "unavailable";

type LiveState =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable";

function StartupScreen({
  error,
  onRetry,
}: {
  error: StartupError | null;
  onRetry?: () => void;
}) {
  const isError = Boolean(error);

  return (
    <main className="grid min-h-svh place-items-center bg-background p-6">
      <section className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
        {isError ? (
          <AlertTriangle
            aria-hidden="true"
            className="mx-auto size-8 text-amber-600"
          />
        ) : (
          <LoaderCircle
            aria-hidden="true"
            className="mx-auto size-8 animate-spin text-primary"
          />
        )}
        <h1 className="mt-4 text-lg font-semibold">
          {isError
            ? "POS startup is temporarily unavailable"
            : "Starting point of sale"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isError
            ? "Please try again. Your existing offline checkout queue is unchanged."
            : "Preparing your authorized POS workspace…"}
        </p>
        {error?.requestId ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Request ID: {error.requestId}
          </p>
        ) : null}
        {onRetry ? (
          <Button
            className="mt-5"
            onClick={onRetry}
            type="button"
          >
            <RefreshCw aria-hidden="true" />
            Retry
          </Button>
        ) : null}
      </section>
    </main>
  );
}

function DomainWarning({
  children,
  onRetry,
}: {
  children: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
      <span className="flex items-center gap-2">
        <AlertTriangle
          aria-hidden="true"
          className="size-4 shrink-0"
        />
        {children}
      </span>
      {onRetry ? (
        <Button
          onClick={onRetry}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCw aria-hidden="true" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function PosV2TerminalShell() {
  const router =
    useRouter();
  const [core, setCore] =
    useState<PosV2Core | null>(null);
  const [coreState, setCoreState] =
    useState<"loading" | "ready" | "error">("loading");
  const [coreError, setCoreError] =
    useState<StartupError | null>(null);
  const [reference, setReference] =
    useState<PosReferenceV2Response["reference"]>(
      EMPTY_REFERENCE,
    );
  const [referenceState, setReferenceState] =
    useState<ReferenceState>("idle");
  const [live, setLive] =
    useState<PosLiveV2Response["live"]>(
      EMPTY_LIVE,
    );
  const [liveState, setLiveState] =
    useState<LiveState>("idle");

  const loadCore =
    useCallback(async () => {
      setCoreState("loading");
      setCoreError(null);

      try {
        const response =
          await fetchPosV2Core();

        setCore(response.core);
        setReference(EMPTY_REFERENCE);
        setReferenceState("loading");
        setLive(EMPTY_LIVE);
        setLiveState("loading");
        setCoreState("ready");
      } catch (error) {
        if (
          error instanceof PosV2ApiError
          && error.status === 401
        ) {
          router.replace("/login");
          return;
        }

        if (
          error instanceof PosV2ApiError
          && error.status === 403
        ) {
          router.replace("/workspace/no-access");
          return;
        }

        setCoreError({
          requestId:
            error instanceof PosV2ApiError
              ? error.requestId
              : null,
        });
        setCoreState("error");
      }
    }, [router]);

  const refreshReference =
    useCallback(async () => {
      if (!core) {
        return;
      }

      const offlineScope =
        `${core.organization.id}:${core.profileId}`;

      setReferenceState("loading");

      try {
        const response =
          await fetchPosV2Reference(
            core.organization.id,
          );

        setReference(response.reference);
        setReferenceState("ready");

        void cachePosV2Reference({
          scope: offlineScope,
          organizationId: core.organization.id,
          referenceVersion:
            response.referenceVersion,
          reference: response.reference,
        }).catch(() => undefined);
      } catch {
        const cached =
          await getCachedPosV2Reference(
            offlineScope,
            core.organization.id,
          ).catch(() => undefined);

        if (cached) {
          setReference(cached.reference);
          setReferenceState("cached");
          return;
        }

        setReference(EMPTY_REFERENCE);
        setReferenceState("unavailable");
      }
    }, [core]);

  const refreshLive =
    useCallback(async (
      scope?: {
        storeId?: string | null;
        registerId?: string | null;
      },
    ) => {
      if (!core) {
        return;
      }

      setLiveState("loading");

      try {
        const response =
          await fetchPosV2Live(
            core.organization.id,
            scope ?? {
              storeId:
                core.activeShift?.storeId
                ?? null,
              registerId:
                core.activeShift?.registerId
                ?? null,
            },
          );

        setLive(response.live);
        setLiveState("ready");
      } catch {
        setLive(EMPTY_LIVE);
        setLiveState("unavailable");
      }
    }, [core]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => {
        void loadCore();
      },
      0,
    );

    return () => window.clearTimeout(timer);
  }, [loadCore]);

  useEffect(() => {
    if (!core) {
      return;
    }

    const timer = window.setTimeout(
      () => {
        void refreshReference();
        void refreshLive();
      },
      0,
    );

    return () => window.clearTimeout(timer);
  }, [core, refreshLive, refreshReference]);

  const features =
    useMemo(
      () => createFeatureSettings(
        Object.entries(core?.features ?? {})
          .filter(
            (
              entry,
            ): entry is [string, boolean] =>
              typeof entry[1] === "boolean",
          )
          .map(
            ([featureKey, isEnabled]) => ({
              featureKey,
              isEnabled,
            }),
          ),
      ),
      [core?.features],
    );

  if (coreState === "error") {
    return (
      <StartupScreen
        error={coreError}
        onRetry={() => {
          void loadCore();
        }}
      />
    );
  }

  if (
    coreState === "loading"
    || !core
  ) {
    return <StartupScreen error={null} />;
  }

  const capabilities =
    getPosCapabilities({
      businessType:
        core.organization.businessType,
      features,
      permissions: core.permissions,
    });
  const canAccessBackOffice =
    canAccessBackOfficeV2(
      core.permissions,
      features.inventory,
    );
  const offlineScope =
    `${core.organization.id}:${core.profileId}`;

  return (
    <div className="relative">
      {referenceState === "loading" ? (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-50 sm:inset-x-5">
          <p className="inline-flex rounded-md bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm ring-1 ring-border">
            Loading POS configuration…
          </p>
        </div>
      ) : null}
      {referenceState === "cached" ? (
        <div className="absolute inset-x-3 top-3 z-50 sm:inset-x-5">
          <DomainWarning
            onRetry={() => {
              void refreshReference();
            }}
          >
            Reference data is cached and may be out of date.
          </DomainWarning>
        </div>
      ) : null}
      {referenceState === "unavailable" ? (
        <div className="absolute inset-x-3 top-3 z-50 sm:inset-x-5">
          <DomainWarning
            onRetry={() => {
              void refreshReference();
            }}
          >
            POS configuration is temporarily unavailable.
          </DomainWarning>
        </div>
      ) : null}
      {liveState === "unavailable" ? (
        <div className="absolute inset-x-3 top-16 z-50 sm:inset-x-5">
          <DomainWarning
            onRetry={() => {
              void refreshLive();
            }}
          >
            Live POS tools are temporarily unavailable.
          </DomainWarning>
        </div>
      ) : null}
      <PosTerminal
        activeShift={core.activeShift}
        canAccessBackOffice={canAccessBackOffice}
        canReceiveIncomingTransfers={
          live.canReceiveIncomingTransfers
        }
        {...capabilities}
        categories={reference.categories}
        customerDisplaySessions={
          features.customer_display
            ? live.customerDisplaySessions
            : []
        }
        deviceManagementEnabled={
          core.organization.deviceManagementEnabled
        }
        diningOptions={
          capabilities.canUseDining
            ? reference.diningOptions
            : []
        }
        discounts={
          capabilities.canApplyDiscounts
            ? reference.discounts
            : []
        }
        currencyCode={core.organization.currencyCode}
        employeeName={core.employee.name}
        incomingTransfers={live.incomingTransfers}
        loyaltyProgram={
          capabilities.canUseCustomerLoyalty
            ? reference.loyaltyProgram
            : null
        }
        onRefreshLive={refreshLive}
        openTickets={
          capabilities.canUseOpenTickets
            ? live.openTickets
            : []
        }
        offlineScope={offlineScope}
        organizationId={core.organization.id}
        organizationName={core.organization.name}
        paymentMethods={reference.paymentMethods}
        registers={core.registers}
        stores={core.stores}
        taxRates={reference.taxRates}
        ticketAssignees={
          capabilities.canUseOpenTickets
            ? live.ticketAssignees
            : []
        }
        ticketTemplates={
          capabilities.canUseOpenTickets
            ? reference.ticketTemplates
            : []
        }
        timeClockEntry={
          capabilities.canUseTimeClock
            ? live.timeClockEntry
            : null
        }
        timezone={core.organization.timezone}
      />
    </div>
  );
}
