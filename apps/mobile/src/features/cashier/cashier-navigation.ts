export type CashierNavigationSection =
  | "CHECKOUT"
  | "OPERATIONS"
  | "SUPPORT";

export type CashierNavigationItem = {
  path: string;
  label: string;
  description: string;
  section: CashierNavigationSection;
};

type CashierNavigationGates = {
  receipts: boolean;
  customers: boolean;
  shift: boolean;
  tickets: boolean;
  transfers: boolean;
  timeClock: boolean;
};

export function buildCashierNavigation(input: {
  gates: CashierNavigationGates;
  permissions: string[];
}) {
  const canUseSupportDiagnostics =
    input.permissions.includes("devices.manage")
    || input.permissions.includes("settings.manage");

  const items: CashierNavigationItem[] = [
    {
      path: "/pos",
      label: "Start selling",
      description: "Open the register and build a customer sale.",
      section: "CHECKOUT",
    },
    ...(input.gates.receipts ? [{
      path: "/receipts",
      label: "Receipts",
      description: "Find accepted and completed sales.",
      section: "OPERATIONS" as const,
    }] : []),
    ...(input.gates.customers ? [{
      path: "/customers",
      label: "Customers",
      description: "Find or add a customer for a sale.",
      section: "OPERATIONS" as const,
    }] : []),
    ...(input.gates.shift ? [{
      path: "/shift",
      label: "Shift and cash drawer",
      description: "Open, review, or close the assigned shift.",
      section: "OPERATIONS" as const,
    }] : []),
    ...(input.gates.tickets ? [{
      path: "/tickets",
      label: "Open tickets",
      description: "Resume and manage saved customer tickets.",
      section: "OPERATIONS" as const,
    }] : []),
    ...(input.gates.transfers ? [{
      path: "/transfers",
      label: "Incoming transfers",
      description: "Receive inventory assigned to this store.",
      section: "OPERATIONS" as const,
    }] : []),
    ...(input.gates.timeClock ? [{
      path: "/time-clock",
      label: "Time clock",
      description: "Clock in or out with an employee PIN.",
      section: "OPERATIONS" as const,
    }] : []),
    {
      path: "/sync-status",
      label: "Sync and recovery",
      description: "Review saved transactions and reconnect safely.",
      section: "SUPPORT",
    },
    {
      path: "/settings",
      label: "Account and support",
      description: "View terminal details, policies, and sign out.",
      section: "SUPPORT",
    },
    ...(canUseSupportDiagnostics ? [
      {
        path: "/hardware",
        label: "Hardware support",
        description: "Review the approved v1 hardware scope.",
        section: "SUPPORT" as const,
      },
      {
        path: "/offline-payments",
        label: "Payment safety",
        description: "Review offline payment restrictions.",
        section: "SUPPORT" as const,
      },
      {
        path: "/production-readiness",
        label: "Release diagnostics",
        description: "Authorized upgrade and version diagnostics.",
        section: "SUPPORT" as const,
      },
    ] : []),
  ];

  return items;
}
