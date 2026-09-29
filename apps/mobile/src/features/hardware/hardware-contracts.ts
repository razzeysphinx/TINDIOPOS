export type HardwareCapability =
  | "CAMERA_BARCODE_SCANNER"
  | "HID_BARCODE_SCANNER"
  | "BLUETOOTH_PRINTER"
  | "USB_PRINTER"
  | "LAN_PRINTER"
  | "CASH_DRAWER"
  | "CUSTOMER_DISPLAY"
  | "KDS"
  | "PAYMENT_TERMINAL";

export type HardwareSupportState =
  | "IMPLEMENTED"
  | "OS_MANAGED"
  | "ADAPTER_REQUIRED";

export type HardwareCapabilityDescriptor = {
  capability: HardwareCapability;
  support: HardwareSupportState;
  transactionRole:
    | "INPUT_ONLY"
    | "POST_TRANSACTION_SIDE_EFFECT"
    | "EXTERNAL_PAYMENT_PROVIDER";
  note: string;
};

export type HardwareActionResult<T = undefined> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      code:
        | "PERMISSION_DENIED"
        | "NOT_CONFIGURED"
        | "UNSUPPORTED"
        | "UNAVAILABLE"
        | "FAILED";
      message: string;
    };

export type ReceiptPrintRequest = {
  operationId: string;
  receiptNumber: number;
  currencyCode: string;
  totalMinor: number;
};

export type CashDrawerRequest = {
  operationId: string;
};

export type CustomerDisplayRequest = {
  operationId: string;
  state: "IDLE" | "CART" | "PAYMENT" | "COMPLETE";
};

export type KdsDispatchRequest = {
  operationId: string;
  saleId: string;
};

export type PaymentTerminalRequest = {
  operationId: string;
  amountMinor: number;
  currencyCode: string;
};

export interface ReceiptPrinterAdapter {
  readonly capability:
    | "BLUETOOTH_PRINTER"
    | "USB_PRINTER"
    | "LAN_PRINTER";

  printReceipt(
    request: ReceiptPrintRequest,
  ): Promise<HardwareActionResult>;
}

export interface CashDrawerAdapter {
  readonly capability: "CASH_DRAWER";

  openDrawer(
    request: CashDrawerRequest,
  ): Promise<HardwareActionResult>;
}

export interface CustomerDisplayAdapter {
  readonly capability: "CUSTOMER_DISPLAY";

  publish(
    request: CustomerDisplayRequest,
  ): Promise<HardwareActionResult>;
}

export interface KdsAdapter {
  readonly capability: "KDS";

  dispatch(
    request: KdsDispatchRequest,
  ): Promise<HardwareActionResult>;
}

export interface PaymentTerminalAdapter {
  readonly capability: "PAYMENT_TERMINAL";

  authorize(
    request: PaymentTerminalRequest,
  ): Promise<HardwareActionResult<{
    providerReference: string;
    approvedAmountMinor: number;
  }>>;
}

export const hardwareCapabilityMatrix:
  HardwareCapabilityDescriptor[] = [
    {
      capability:
        "CAMERA_BARCODE_SCANNER",
      support: "IMPLEMENTED",
      transactionRole: "INPUT_ONLY",
      note:
        "Uses the device camera to populate the existing local barcode lookup path.",
    },
    {
      capability:
        "HID_BARCODE_SCANNER",
      support: "OS_MANAGED",
      transactionRole: "INPUT_ONLY",
      note:
        "USB/Bluetooth scanners operating as keyboard/HID wedges use the existing barcode input and Enter submit behavior.",
    },
    {
      capability:
        "BLUETOOTH_PRINTER",
      support: "ADAPTER_REQUIRED",
      transactionRole:
        "POST_TRANSACTION_SIDE_EFFECT",
      note:
        "Requires a selected printer transport/vendor adapter. Printing must never decide whether a sale committed.",
    },
    {
      capability:
        "USB_PRINTER",
      support: "ADAPTER_REQUIRED",
      transactionRole:
        "POST_TRANSACTION_SIDE_EFFECT",
      note:
        "Requires Android USB host/vendor transport behind ReceiptPrinterAdapter.",
    },
    {
      capability:
        "LAN_PRINTER",
      support: "ADAPTER_REQUIRED",
      transactionRole:
        "POST_TRANSACTION_SIDE_EFFECT",
      note:
        "Requires a configured LAN printer transport behind ReceiptPrinterAdapter.",
    },
    {
      capability: "CASH_DRAWER",
      support: "ADAPTER_REQUIRED",
      transactionRole:
        "POST_TRANSACTION_SIDE_EFFECT",
      note:
        "Must be triggered only after the sale/payment outcome is already durable.",
    },
    {
      capability:
        "CUSTOMER_DISPLAY",
      support: "ADAPTER_REQUIRED",
      transactionRole:
        "POST_TRANSACTION_SIDE_EFFECT",
      note:
        "Existing TINDIO customer-display domain remains separate from the native hardware transport.",
    },
    {
      capability: "KDS",
      support: "ADAPTER_REQUIRED",
      transactionRole:
        "POST_TRANSACTION_SIDE_EFFECT",
      note:
        "Existing kitchen/KDS domain remains authoritative; native transport failures cannot change sale state.",
    },
    {
      capability:
        "PAYMENT_TERMINAL",
      support: "ADAPTER_REQUIRED",
      transactionRole:
        "EXTERNAL_PAYMENT_PROVIDER",
      note:
        "Online terminal providers must use compliant provider adapters. Offline electronic payments remain Phase 20.",
    },
  ];