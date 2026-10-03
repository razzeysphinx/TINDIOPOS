export function cashierFeatureGates(core: {
  features: Record<string, boolean>;
  permissions: string[];
}) {
  const has = (permission: string) => core.permissions.includes(permission);
  const canCreateSales = has("pos.access") && has("sales.create");

  return {
    receipts: canCreateSales && has("receipts.view"),
    customers: canCreateSales,
    shift: ["shifts.open", "shifts.close", "cash.pay_in", "cash.pay_out"].some(has),
    tickets:
      Boolean(core.features.open_tickets)
      && canCreateSales
      && has("tickets.manage"),
    transfers:
      Boolean(core.features.inventory)
      && Boolean(core.features.transfers)
      && has("inventory.transfer.receive"),
    timeClock:
      Boolean(core.features.time_clock)
      && has("attendance.use"),
    dining: Boolean(core.features.dining) && canCreateSales,
    modifiers: Boolean(core.features.modifiers) && canCreateSales,
    loyalty: Boolean(core.features.loyalty) && canCreateSales,
  };
}
