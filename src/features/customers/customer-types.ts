export type CustomerActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string };

export type CustomerListItem = {
  id: string;
  customerNumber: number;
  loyaltyCardCode: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: "active" | "archived";
  points: number;
};

export type CustomerSegmentOption = {
  id: string;
  name: string;
  description: string | null;
};

export type LoyaltyProgramConfig = {
  isEnabled: boolean;
  earnSpendMinor: number;
  earnPoints: number;
  redemptionValueMinor: number;
  minimumRedemptionPoints: number;
};

export type CustomersOverview = {
  customers: CustomerListItem[];
  segments: CustomerSegmentOption[];
  program: LoyaltyProgramConfig | null;
};

export type CustomerProfile = {
  id: string;
  customerNumber: number;
  loyaltyCardCode: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  birthday: string | null;
  notes: string | null;
  status: "active" | "archived";
  createdAt: string;
};

export type CustomerSummary = {
  loyaltyPoints: number;
  saleCount: number;
  lifetimeSpendMinor: number;
  averageSaleMinor: number;
  lastPurchaseAt: string | null;
};

export type CustomerPurchase = {
  saleId: string;
  storeName: string;
  receiptNumber: number | null;
  completedAt: string;
  loyaltyPointsEarned: number | null;
  loyaltyPointsRedeemed: number | null;
  totalMinor: number;
  currencyCode: string;
};

export type CustomerLedgerEntry = {
  id: string;
  entryType: string;
  pointsDelta: number;
  note: string | null;
  createdAt: string;
};

export type LoyaltyCardStatus = "active" | "reward_claimed" | "revoked" | "replaced" | "expired";

export type LoyaltyCard = {
  id: string;
  cardCode: string;
  status: LoyaltyCardStatus;
  stampCount: number;
  stampTarget: number;
  issuedAt: string;
  expiresAt: string | null;
  deactivatedAt: string | null;
  deactivationReason: string | null;
};

export type LoyaltyCardEvent = {
  id: string;
  loyaltyCardId: string;
  cardCode: string;
  eventType: "ISSUED" | "STAMP_ADDED" | "REWARD_CLAIMED" | "REVOKED" | "REPLACED" | "QR_ROTATED";
  stampCountBefore: number;
  stampDelta: number;
  stampCountAfter: number;
  saleId: string | null;
  reason: string | null;
  createdAt: string;
};

export type LoyaltyCardCredential = {
  cardId: string;
  cardCode: string;
  verificationToken: string;
};

export type CustomerProfileWorkspace = {
  customer: CustomerProfile;
  summary: CustomerSummary | null;
  history: CustomerPurchase[];
  ledger: CustomerLedgerEntry[];
  loyaltyCards: LoyaltyCard[];
  loyaltyCardEvents: LoyaltyCardEvent[];
  segments: CustomerSegmentOption[];
  selectedSegmentIds: string[];
};
