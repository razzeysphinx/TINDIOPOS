import type {
  PosIncomingTransfer,
  PosOpenTicket,
  PosTicketAssignee,
} from "@/features/pos/pos-types";
import {
  isReceivableTransferState,
} from "@/features/inventory/inventory-transfer-reader-contract";

type RecordValue =
  Record<string, unknown>;

function isRecord(
  value: unknown,
): value is RecordValue {
  return (
    Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
  );
}

function isString(
  value: unknown,
): value is string {
  return typeof value === "string";
}

function nullableString(
  value: unknown,
) {
  return isString(value)
    ? value
    : null;
}

function finiteNumber(
  value: unknown,
) {
  const parsed =
    typeof value === "number"
      ? value
      : Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function mapIncomingTransferLines(
  value: unknown,
): PosIncomingTransfer["lines"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((line) => {
    if (!isRecord(line)) {
      return [];
    }

    if (
      !isString(line.id)
      || !isString(line.label)
      || !isString(line.unit)
    ) {
      return [];
    }

    return [{
      id: line.id,
      label: line.label,
      unit: line.unit,
      quantity:
        finiteNumber(line.quantity),
      receivedQuantity:
        finiteNumber(line.received_quantity),
      shortQuantity:
        finiteNumber(line.short_quantity),
    }];
  });
}

export function mapPosV2IncomingTransfers(
  rows: unknown,
): PosIncomingTransfer[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.flatMap((row) => {
    if (!isRecord(row)) {
      return [];
    }

    const lines =
      mapIncomingTransferLines(row.lines);
    const status =
      isString(row.status)
        ? row.status
        : "";
    const stockRequestId =
      nullableString(row.stock_request_id);

    if (
      !lines.length
      || !isReceivableTransferState(
        status,
        stockRequestId,
      )
      || !isString(row.transfer_id)
      || !isString(row.source_store_id)
      || !isString(row.source_store_name)
      || !isString(row.destination_store_id)
      || !isString(row.destination_store_name)
    ) {
      return [];
    }

    return [{
      id: row.transfer_id,
      transferNumber:
        finiteNumber(row.transfer_number),
      stockRequestId,
      sourceStoreId:
        row.source_store_id,
      sourceStoreName:
        row.source_store_name,
      destinationStoreId:
        row.destination_store_id,
      destinationStoreName:
        row.destination_store_name,
      status,
      note: nullableString(row.note),
      lines,
    }];
  });
}

function mapTicketModifiers(
  value: unknown,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((modifier) => {
    if (
      !isRecord(modifier)
      || !isString(modifier.id)
      || !isString(modifier.name)
      || typeof modifier.priceMinor !== "number"
    ) {
      return [];
    }

    return [{
      id: modifier.id,
      name: modifier.name,
      priceMinor: modifier.priceMinor,
    }];
  });
}

function mapTicketCartLine(
  value: unknown,
) {
  if (
    !isRecord(value)
    || !isString(value.product_id)
  ) {
    return null;
  }

  return {
    productId: value.product_id,
    variantId:
      nullableString(value.variant_id),
    quantity:
      finiteNumber(value.quantity),
    modifierOptionIds:
      Array.isArray(value.modifier_option_ids)
        ? value.modifier_option_ids.filter(
            isString,
          )
        : [],
    productName:
      isString(value.productName)
        ? value.productName
        : "Saved item",
    variantName:
      nullableString(value.variantName),
    sku: nullableString(value.sku),
    barcode:
      nullableString(value.barcode),
    categoryId:
      nullableString(value.categoryId),
    priceMinor:
      typeof value.priceMinor === "number"
        ? value.priceMinor
        : 0,
    unit:
      isString(value.unit)
        ? value.unit
        : "each",
    imageUrl:
      nullableString(value.imageUrl),
    isVariablePrice:
      value.isVariablePrice === true,
    allowFractionalQuantity:
      value.allowFractionalQuantity === true,
    manualPriceMinor:
      typeof value.manualPriceMinor === "number"
        ? value.manualPriceMinor
        : null,
    ticketLineId:
      isString(value.ticket_line_id)
        ? value.ticket_line_id
        : undefined,
    itemNote:
      nullableString(value.item_note),
    modifiers:
      mapTicketModifiers(value.modifiers),
  };
}

function mapTicketCustomer(
  ticket: RecordValue,
): PosOpenTicket["customer"] {
  if (
    !isString(ticket.customer_id)
    || !isString(ticket.customer_full_name)
  ) {
    return null;
  }

  return {
    id: ticket.customer_id,
    customerNumber:
      finiteNumber(ticket.customer_number),
    loyaltyCardCode:
      isString(ticket.loyalty_card_code)
        ? ticket.loyalty_card_code
        : "",
    fullName:
      ticket.customer_full_name,
    phone:
      nullableString(ticket.customer_phone),
    email:
      nullableString(ticket.customer_email),
    loyaltyPoints:
      finiteNumber(ticket.customer_loyalty_points),
  };
}

export function mapPosV2OpenTickets(
  rows: unknown,
): PosOpenTicket[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.flatMap((ticket) => {
    if (
      !isRecord(ticket)
      || !Array.isArray(ticket.cart)
      || !isString(ticket.ticket_id)
      || !isString(ticket.label)
      || !isString(ticket.updated_at)
    ) {
      return [];
    }

    const cart =
      ticket.cart.flatMap((line) => {
        const mapped =
          mapTicketCartLine(line);

        return mapped
          ? [mapped]
          : [];
      });

    if (!cart.length) {
      return [];
    }

    return [{
      id: ticket.ticket_id,
      label: ticket.label,
      note: nullableString(ticket.note),
      customer:
        mapTicketCustomer(ticket),
      diningOptionId:
        nullableString(ticket.dining_option_id),
      assignedEmployeeId:
        nullableString(ticket.assigned_employee_id),
      cart,
      updatedAt:
        ticket.updated_at,
    }];
  });
}

export function mapPosV2TicketAssignees(
  rows: unknown,
): PosTicketAssignee[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.flatMap((assignee) => {
    if (
      !isRecord(assignee)
      || !isString(assignee.id)
      || !isString(assignee.fullName)
    ) {
      return [];
    }

    return [{
      id: assignee.id,
      fullName:
        assignee.fullName,
    }];
  });
}
