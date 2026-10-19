import type { PosCartLine } from "./cart";
import type { PosCustomer } from "./pos-data";

export type PosStore = {
  id: string;
  name: string;
};

export type PosRegister = {
  id: string;
  storeId: string;
  name: string;
  code: string;
};

export type PosActiveShift = {
  id: string;
  storeId: string;
  registerId: string;
  openingCashMinor: number;
  openedAt: string;
};

export type PosOpenTicket = {
  id: string;
  label: string;
  note: string | null;
  customer: PosCustomer | null;
  diningOptionId: string | null;
  assignedEmployeeId: string | null;
  cart: PosCartLine[];
  updatedAt: string;
};

export type PosTicketAssignee = {
  id: string;
  fullName: string;
};

export type PosOpenShiftV2Response =
  | { ok: true; message: string; shift: PosActiveShift }
  | { ok: false; message: string };

export type PosClientUpgradeRequiredResponse = {
  ok: false;
  code: "POS_CLIENT_UPGRADE_REQUIRED";
  requiredCapability: "SHIFT_CUSTODY_FINALIZATION_V1";
  retryable: false;
  preservesRecovery: true;
  message: string;
};

export type PosCloseShiftV2Response =
  | {
      ok: true;
      message: string;
      closeSummary?: {
        expectedCashMinor: number;
        countedCashMinor: number;
        differenceMinor: number;
      };
    }
  | { ok: false; message: string }
  | PosClientUpgradeRequiredResponse;
