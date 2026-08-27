export const TINDIO_PAYMENT_PRESET_CODES = [
  "CASH",
  "CARD",
  "GCASH",
  "MAYA",
  "BANK_TRANSFER",
] as const;

export type TindioPaymentPresetCode = (typeof TINDIO_PAYMENT_PRESET_CODES)[number];

export const TINDIO_PAYMENT_PRESETS = [
  {
    code: "CASH",
    name: "Cash",
    paymentType: "CASH",
    description: "Accept cash, including approved offline cash sales.",
  },
  {
    code: "CARD",
    name: "Card",
    paymentType: "CARD",
    description: "Record card-terminal payments.",
  },
  {
    code: "GCASH",
    name: "GCash",
    paymentType: "E_WALLET",
    description: "Record GCash e-wallet payments.",
  },
  {
    code: "MAYA",
    name: "Maya",
    paymentType: "E_WALLET",
    description: "Record Maya e-wallet payments.",
  },
  {
    code: "BANK_TRANSFER",
    name: "Bank Transfer",
    paymentType: "BANK_TRANSFER",
    description: "Record bank-transfer payments.",
  },
] as const satisfies ReadonlyArray<{
  code: TindioPaymentPresetCode;
  name: string;
  paymentType: "CASH" | "CARD" | "E_WALLET" | "BANK_TRANSFER";
  description: string;
}>;

export function isTindioPaymentPresetCode(code: string): code is TindioPaymentPresetCode {
  return (TINDIO_PAYMENT_PRESET_CODES as readonly string[]).includes(code);
}

export function getTindioPaymentPreset(code: TindioPaymentPresetCode) {
  return TINDIO_PAYMENT_PRESETS.find((preset) => preset.code === code);
}
