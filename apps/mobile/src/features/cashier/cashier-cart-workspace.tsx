import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  PosCartLine,
  PosCustomer,
  PosDiningOption,
  PosDiscount,
  PosTaxRate,
} from "../../../../../src/contracts/pos";
import { posItemKey } from "../../../../../src/features/pos/pos-types";

import { TindioButton } from "../../ui/tindio-button";
import { TindioFeedback } from "../../ui/tindio-feedback";
import { TindioInput } from "../../ui/tindio-input";
import { tindioTheme } from "../../ui/theme";
import { useTindioResponsiveLayout } from "../../ui/tindio-responsive";
import type { CartInventoryIntelligenceLine } from "../inventory/offline-inventory-intelligence";
import type { LocalCartTotals } from "../local-first/local-cart";
import { CashierCartLine } from "./cashier-cart-line";
import { formatMoney } from "./cashier-format";

type CashierCartWorkspaceProps = {
  cart: PosCartLine[];
  currencyCode: string;
  totals: LocalCartTotals;
  inventory: CartInventoryIntelligenceLine[];
  compact: boolean;
  expanded: boolean;
  canEditQuantity: boolean;
  canRemove: boolean;
  canApplyDiscounts: boolean;
  discounts: PosDiscount[];
  discountId: string | null;
  taxes: PosTaxRate[];
  taxId: string | null;
  diningEnabled: boolean;
  diningOptions: PosDiningOption[];
  diningOptionId: string | null;
  selectedCustomer: PosCustomer | null;
  customerQuery: string;
  customerRows: PosCustomer[];
  canCreateCustomers: boolean;
  online: boolean;
  newCustomerName: string;
  newCustomerEmail: string;
  newCustomerPhone: string;
  restrictionMessage: string | null;
  onToggle(): void;
  onQuantity(line: PosCartLine, value: number): void;
  onNote(line: PosCartLine, value: string | null): void;
  onReconfigure(line: PosCartLine): void;
  onRemove(line: PosCartLine): void;
  onDiscount(value: string | null): void;
  onTax(value: string): void;
  onDining(value: string): void;
  onCustomerQuery(value: string): void;
  onSearchCustomers(): void;
  onSelectCustomer(value: PosCustomer | null): void;
  onNewCustomerName(value: string): void;
  onNewCustomerEmail(value: string): void;
  onNewCustomerPhone(value: string): void;
  onCreateCustomer(): void;
};

export function CashierCartWorkspace(props: CashierCartWorkspaceProps) {
  const { isLargeText, viewportClass } = useTindioResponsiveLayout();
  const {
    cart,
    compact,
    currencyCode,
    expanded,
    onToggle,
    totals,
  } = props;
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const stacked = isLargeText || viewportClass === "compact-phone";

  return (
    <View style={styles.panel} testID="cashier-cart-workspace">
      <View style={[styles.header, stacked ? styles.stacked : null]}>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.title}>Current cart</Text>
          <Text style={styles.itemCount}>
            {cart.length === 0 ? "No items yet" : `${formatQuantity(itemCount)} item${itemCount === 1 ? "" : "s"}`}
          </Text>
        </View>
        <View style={[styles.headerTotal, stacked ? styles.alignStart : null]}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text accessibilityLabel={`Cart total ${formatMoney(totals.totalMinor, currencyCode)}`} style={styles.totalValue}>
            {formatMoney(totals.totalMinor, currencyCode)}
          </Text>
        </View>
      </View>

      {compact ? (
        <TindioButton accessibilityState={{ expanded }} onPress={onToggle} variant="secondary">
          {expanded ? "Hide cart" : `View cart (${cart.length})`}
        </TindioButton>
      ) : null}

      {expanded ? <CartContents {...props} /> : null}
    </View>
  );
}

function CartContents({
  cart,
  currencyCode,
  totals,
  inventory,
  canEditQuantity,
  canRemove,
  canApplyDiscounts,
  discounts,
  discountId,
  taxes,
  taxId,
  diningEnabled,
  diningOptions,
  diningOptionId,
  selectedCustomer,
  customerQuery,
  customerRows,
  canCreateCustomers,
  online,
  newCustomerName,
  newCustomerEmail,
  newCustomerPhone,
  restrictionMessage,
  onQuantity,
  onNote,
  onReconfigure,
  onRemove,
  onDiscount,
  onTax,
  onDining,
  onCustomerQuery,
  onSearchCustomers,
  onSelectCustomer,
  onNewCustomerName,
  onNewCustomerEmail,
  onNewCustomerPhone,
  onCreateCustomer,
}: CashierCartWorkspaceProps) {
  return (
    <View style={styles.contents}>
      {cart.length === 0 ? (
        <View style={styles.emptyCart}>
          <View accessibilityElementsHidden style={styles.emptyCartMark}><Text style={styles.emptyCartGlyph}>□</Text></View>
          <Text style={styles.emptyCartTitle}>Cart is ready</Text>
          <Text style={styles.emptyCartDescription}>Add products from the catalogue or use a barcode scanner.</Text>
        </View>
      ) : (
        <View style={styles.lines}>
          {cart.map((line) => (
            <CashierCartLine
              canEditQuantity={canEditQuantity}
              canRemove={canRemove}
              currencyCode={currencyCode}
              key={`${posItemKey(line)}:${line.quantity}:${line.itemNote ?? ""}`}
              line={line}
              onNote={(value) => onNote(line, value)}
              onQuantity={(value) => onQuantity(line, value)}
              onReconfigure={() => onReconfigure(line)}
              onRemove={() => onRemove(line)}
            />
          ))}
        </View>
      )}

      {restrictionMessage ? (
        <TindioFeedback
          description={restrictionMessage}
          kind="restriction"
          testID="offline-cart-restriction"
          title="Connect before taking offline payment"
        />
      ) : null}

      <MoneySummary currencyCode={currencyCode} totals={totals} />

      <View style={styles.section}>
        <SectionHeading description="Choose the sale settings that apply." title="Sale details" />
        {canApplyDiscounts ? (
          <OptionGroup label="Discount">
            <SelectionChip label="No discount" onPress={() => onDiscount(null)} selected={discountId === null} />
            {discounts.map((discount) => (
              <SelectionChip
                key={discount.id}
                label={discount.name}
                onPress={() => onDiscount(discount.id)}
                selected={discountId === discount.id}
              />
            ))}
          </OptionGroup>
        ) : null}

        <OptionGroup label="Tax">
          {taxes.map((tax) => (
            <SelectionChip key={tax.id} label={tax.name} onPress={() => onTax(tax.id)} selected={taxId === tax.id} />
          ))}
        </OptionGroup>

        {diningEnabled ? (
          <OptionGroup label="Dining option">
            {diningOptions.map((option) => (
              <SelectionChip
                key={option.id}
                label={option.name}
                onPress={() => onDining(option.id)}
                selected={diningOptionId === option.id}
              />
            ))}
          </OptionGroup>
        ) : null}
      </View>

      <CustomerSection
        canCreate={canCreateCustomers}
        customerQuery={customerQuery}
        customerRows={customerRows}
        newCustomerEmail={newCustomerEmail}
        newCustomerName={newCustomerName}
        newCustomerPhone={newCustomerPhone}
        onCreate={onCreateCustomer}
        onNewCustomerEmail={onNewCustomerEmail}
        onNewCustomerName={onNewCustomerName}
        onNewCustomerPhone={onNewCustomerPhone}
        onQuery={onCustomerQuery}
        onSearch={onSearchCustomers}
        onSelect={onSelectCustomer}
        online={online}
        selectedCustomer={selectedCustomer}
      />

      <InventoryEstimate inventory={inventory} />
    </View>
  );
}

function MoneySummary({ currencyCode, totals }: { currencyCode: string; totals: LocalCartTotals }) {
  return (
    <View accessibilityLabel="Cart totals" style={styles.moneySummary}>
      <MoneyRow label="Subtotal" value={formatMoney(totals.subtotalMinor, currencyCode)} />
      <MoneyRow label="Discount" value={`-${formatMoney(totals.discountMinor, currencyCode)}`} />
      <MoneyRow label="Tax" value={formatMoney(totals.taxMinor, currencyCode)} />
      <View style={styles.totalDivider} />
      <MoneyRow emphasis label="Total" value={formatMoney(totals.totalMinor, currencyCode)} />
    </View>
  );
}

function MoneyRow({ emphasis = false, label, value }: { emphasis?: boolean; label: string; value: string }) {
  return (
    <View style={styles.moneyRow}>
      <Text style={emphasis ? styles.moneyEmphasis : styles.moneyLabel}>{label}</Text>
      <Text style={emphasis ? styles.moneyEmphasis : styles.moneyValue}>{value}</Text>
    </View>
  );
}

function SectionHeading({ description, title }: { description: string; title: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionDescription}>{description}</Text>
    </View>
  );
}

function OptionGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View style={styles.optionGroup}>
      <Text style={styles.optionLabel}>{label}</Text>
      <View accessibilityRole="radiogroup" style={styles.options}>{children}</View>
    </View>
  );
}

function SelectionChip({ label, onPress, selected }: { label: string; onPress(): void; selected: boolean }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectionChip,
        selected ? styles.selectionChipSelected : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.selectionLabel, selected ? styles.selectionLabelSelected : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

type CustomerSectionProps = {
  selectedCustomer: PosCustomer | null;
  customerQuery: string;
  customerRows: PosCustomer[];
  online: boolean;
  canCreate: boolean;
  newCustomerName: string;
  newCustomerEmail: string;
  newCustomerPhone: string;
  onQuery(value: string): void;
  onSearch(): void;
  onSelect(value: PosCustomer | null): void;
  onNewCustomerName(value: string): void;
  onNewCustomerEmail(value: string): void;
  onNewCustomerPhone(value: string): void;
  onCreate(): void;
};

function CustomerSection({
  selectedCustomer,
  customerQuery,
  customerRows,
  online,
  canCreate,
  newCustomerName,
  newCustomerEmail,
  newCustomerPhone,
  onQuery,
  onSearch,
  onSelect,
  onNewCustomerName,
  onNewCustomerEmail,
  onNewCustomerPhone,
  onCreate,
}: CustomerSectionProps) {
  return (
    <View style={styles.section}>
      <SectionHeading
        description={online ? "Search TINDIO or add a new customer." : "Only customers saved on this device can be found offline."}
        title="Customer"
      />

      {selectedCustomer ? (
        <View style={styles.selectedCustomer}>
          <View style={styles.customerCopy}>
            <Text style={styles.customerName}>{selectedCustomer.fullName}</Text>
            <Text style={styles.customerMeta}>Customer #{selectedCustomer.customerNumber} / {selectedCustomer.loyaltyPoints} points</Text>
          </View>
          <TindioButton onPress={() => onSelect(null)} variant="ghost">Remove</TindioButton>
        </View>
      ) : null}

      <TindioInput
        label="Find customer"
        onChangeText={onQuery}
        onSubmitEditing={onSearch}
        placeholder="Name, email, or phone"
        returnKeyType="search"
        value={customerQuery}
      />
      <TindioButton onPress={onSearch} variant="secondary">
        {online ? "Search customers" : "Search saved customers"}
      </TindioButton>

      {customerRows.length ? (
        <View style={styles.customerResults}>
          {customerRows.map((customer) => (
            <Pressable
              accessibilityRole="button"
              key={customer.id}
              onPress={() => onSelect(customer)}
              style={({ pressed }) => [styles.customerResult, pressed ? styles.pressed : null]}
            >
              <Text style={styles.customerName}>{customer.fullName}</Text>
              <Text style={styles.customerMeta}>#{customer.customerNumber} / {customer.loyaltyPoints} points</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {canCreate && online ? (
        <View style={styles.createCustomer}>
          <Text style={styles.optionLabel}>New customer</Text>
          <TindioInput label="Name" onChangeText={onNewCustomerName} placeholder="Customer name" value={newCustomerName} />
          <TindioInput autoCapitalize="none" keyboardType="email-address" label="Email" onChangeText={onNewCustomerEmail} placeholder="Email address" value={newCustomerEmail} />
          <TindioInput keyboardType="phone-pad" label="Phone" onChangeText={onNewCustomerPhone} placeholder="Phone number" value={newCustomerPhone} />
          <TindioButton disabled={!newCustomerName.trim()} onPress={onCreate}>Create and select customer</TindioButton>
        </View>
      ) : null}
    </View>
  );
}

function InventoryEstimate({ inventory }: { inventory: CartInventoryIntelligenceLine[] }) {
  return (
    <View style={styles.section}>
      <SectionHeading
        description="These device estimates may change after synchronization. They are not authoritative cloud stock."
        title="Estimated stock (may change after sync)"
      />
      {inventory.length ? inventory.map((row) => (
        <View key={`${row.productId}:${row.variantId ?? "simple"}`} style={styles.inventoryCard}>
          <Text style={styles.customerName}>{row.label}</Text>
          <Text style={styles.inventoryScope}>
            {row.scope === "CURRENT_DEVICE_ONLY"
              ? "Current device only. Other offline terminals are not represented here."
              : `Store activity included from ${row.peerDeviceCount} nearby device${row.peerDeviceCount === 1 ? "" : "s"}.`}
          </Text>
          <View style={styles.inventoryNumbers}>
            <InventoryValue label="Last confirmed" value={formatStock(row.lastConfirmedCloudStock)} />
            <InventoryValue label="In this cart" value={formatStock(row.cartQuantity)} />
            <InventoryValue label="After this cart" value={formatStock(row.projectedAfterCurrentCart)} />
          </View>
          <Text style={styles.inventoryMeta}>
            {row.baselineAgeMinutes === null
              ? "No confirmed cloud baseline is saved."
              : `Cloud baseline age: ${row.baselineAgeMinutes} minute${row.baselineAgeMinutes === 1 ? "" : "s"}.`}
          </Text>
          {row.projectedBelowZero ? (
            <TindioFeedback
              description="This device estimate projects stock below zero. Confirm availability before completing the sale."
              kind="restriction"
              title="Estimated stock warning"
            />
          ) : null}
        </View>
      )) : (
        <Text style={styles.sectionDescription}>Add an item to see its estimated stock.</Text>
      )}
    </View>
  );
}

function InventoryValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.inventoryValue}>
      <Text style={styles.inventoryValueLabel}>{label}</Text>
      <Text style={styles.inventoryValueNumber}>{value}</Text>
    </View>
  );
}

function formatStock(value: number | null) {
  return value === null ? "Unknown" : formatQuantity(value);
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: tindioTheme.color.surface.elevated,
    borderColor: tindioTheme.color.border.default,
    borderRadius: tindioTheme.radius.md,
    borderWidth: 1,
    gap: tindioTheme.space.md,
    padding: tindioTheme.space.md,
  },
  header: { alignItems: "flex-start", flexDirection: "row", gap: tindioTheme.space.sm, justifyContent: "space-between" },
  headerCopy: { flex: 1 },
  title: { ...tindioTheme.typography.role.section, color: tindioTheme.color.content.primary },
  itemCount: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary },
  headerTotal: { alignItems: "flex-end" },
  totalLabel: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary },
  totalValue: { ...tindioTheme.typography.role.numeric, color: tindioTheme.color.brand.ink },
  contents: { gap: tindioTheme.space.lg },
  emptyCart: { alignItems: "center", justifyContent: "center", minHeight: 190, padding: tindioTheme.space.lg },
  emptyCartMark: { alignItems: "center", backgroundColor: tindioTheme.color.surface.app, borderRadius: tindioTheme.radius.pill, height: 48, justifyContent: "center", width: 48 },
  emptyCartGlyph: { color: tindioTheme.color.content.secondary, fontSize: 28, lineHeight: 30 },
  emptyCartTitle: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary, marginTop: tindioTheme.space.sm },
  emptyCartDescription: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary, marginTop: tindioTheme.space.xxs, textAlign: "center" },
  lines: { gap: tindioTheme.space.sm },
  moneySummary: { backgroundColor: tindioTheme.color.brand.cream, borderRadius: tindioTheme.radius.md, gap: tindioTheme.space.xs, padding: tindioTheme.space.md },
  moneyRow: { flexDirection: "row", gap: tindioTheme.space.sm, justifyContent: "space-between" },
  moneyLabel: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.secondary },
  moneyValue: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.primary },
  moneyEmphasis: { ...tindioTheme.typography.role.numeric, color: tindioTheme.color.brand.ink },
  totalDivider: { backgroundColor: tindioTheme.color.border.strong, height: 1 },
  section: { borderTopColor: tindioTheme.color.border.default, borderTopWidth: 1, gap: tindioTheme.space.sm, paddingTop: tindioTheme.space.md },
  sectionHeading: { gap: tindioTheme.space.xxs },
  sectionTitle: { ...tindioTheme.typography.role.section, color: tindioTheme.color.content.primary },
  sectionDescription: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary },
  optionGroup: { gap: tindioTheme.space.xs },
  optionLabel: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary },
  options: { flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.xs },
  selectionChip: { borderColor: tindioTheme.color.border.default, borderRadius: tindioTheme.radius.pill, borderWidth: 1, justifyContent: "center", minHeight: tindioTheme.target.minimum, paddingHorizontal: tindioTheme.space.md },
  selectionChipSelected: { backgroundColor: tindioTheme.color.status.success.surface, borderColor: tindioTheme.color.status.success.border },
  selectionLabel: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary },
  selectionLabelSelected: { color: tindioTheme.color.status.success.content },
  selectedCustomer: { alignItems: "center", backgroundColor: tindioTheme.color.status.success.surface, borderRadius: tindioTheme.radius.md, flexDirection: "row", gap: tindioTheme.space.sm, justifyContent: "space-between", padding: tindioTheme.space.sm },
  customerCopy: { flex: 1 },
  customerName: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary },
  customerMeta: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary },
  customerResults: { gap: tindioTheme.space.xs },
  customerResult: { borderColor: tindioTheme.color.border.default, borderRadius: tindioTheme.radius.md, borderWidth: 1, justifyContent: "center", minHeight: tindioTheme.target.minimum, padding: tindioTheme.space.sm },
  createCustomer: { gap: tindioTheme.space.sm },
  inventoryCard: { backgroundColor: tindioTheme.color.surface.app, borderRadius: tindioTheme.radius.md, gap: tindioTheme.space.sm, padding: tindioTheme.space.sm },
  inventoryScope: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.status.information.content },
  inventoryNumbers: { flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.xs },
  inventoryValue: { flex: 1, minWidth: 90 },
  inventoryValueLabel: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary },
  inventoryValueNumber: { ...tindioTheme.typography.role.numeric, color: tindioTheme.color.brand.ink },
  inventoryMeta: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary },
  pressed: { opacity: 0.8 },
  stacked: { alignItems: "stretch", flexDirection: "column" },
  alignStart: { alignItems: "flex-start" },
});
