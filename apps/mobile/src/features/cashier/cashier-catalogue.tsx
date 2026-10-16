import { Pressable, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import type { PosCatalogItem, PosCategory } from "../../../../../src/contracts/pos";

import { TindioButton } from "../../ui/tindio-button";
import { TindioFeedback } from "../../ui/tindio-feedback";
import { TindioInput } from "../../ui/tindio-input";
import { tindioTheme } from "../../ui/theme";
import { formatMoney } from "./cashier-format";

type CashierCatalogueProps = {
  categories: PosCategory[]; categoryId: string | null; currencyCode: string; error: string | null;
  items: PosCatalogItem[]; loading: boolean; lookup: string; query: string; terminalLabel: string;
  onCategory: (categoryId: string | null) => void; onFindBarcode: () => void; onLookupChange: (value: string) => void;
  onOpenCamera: () => void; onProduct: (item: PosCatalogItem) => void; onQueryChange: (value: string) => void;
};

const CATALOGUE_GRID_MIN_WIDTH = 600;

export function CashierCatalogue({ categories, categoryId, currencyCode, error, items, loading, lookup, onCategory, onFindBarcode, onLookupChange, onOpenCamera, onProduct, onQueryChange, query, terminalLabel }: CashierCatalogueProps) {
  const { width } = useWindowDimensions();
  const useGrid = width >= CATALOGUE_GRID_MIN_WIDTH;
  return (
    <View style={styles.catalogue} testID="cashier-catalogue">
      <View style={styles.heading}><View style={styles.headingCopy}><Text style={styles.eyebrow}>SELL</Text><Text accessibilityRole="header" style={styles.title}>Products</Text><Text style={styles.subtitle}>{terminalLabel}</Text></View><Text style={styles.offlineLabel}>Products available offline</Text></View>
      <TindioInput accessibilityLabel="Search products" label="Search products" onChangeText={onQueryChange} placeholder="Name or SKU" returnKeyType="search" value={query} />
      <View style={styles.scanRow}><View style={styles.scanInput}><TindioInput accessibilityLabel="Barcode or SKU" autoCapitalize="none" autoCorrect={false} label="Barcode or SKU" onChangeText={onLookupChange} onSubmitEditing={onFindBarcode} placeholder="Barcode or SKU" returnKeyType="search" value={lookup} /></View><View style={styles.scanActions}><TindioButton onPress={onFindBarcode} variant="secondary">Find item</TindioButton><TindioButton onPress={onOpenCamera} variant="ghost">Scan with camera</TindioButton></View></View>
      <Text style={styles.scannerNote}>Manual entry and the built-in camera are supported. External scanners are not yet certified.</Text>
      <View accessibilityRole="tablist" style={styles.categories}><CategoryChip active={categoryId === null} label="All products" onPress={() => onCategory(null)} />{categories.map((category) => <CategoryChip active={categoryId === category.id} key={category.id} label={category.name} onPress={() => onCategory(category.id)} />)}</View>
      {error ? <TindioFeedback description={error} kind="error" title="Products unavailable" /> : null}
      {loading && items.length === 0 ? <TindioFeedback description="Loading products saved on this device." kind="loading" title="Opening catalogue" /> : null}
      {!loading && !error && items.length === 0 ? <TindioFeedback description={query || categoryId ? "Try a different search or category." : "Reconnect and prepare this register to download its product catalogue."} kind="empty" title="No products found" /> : null}
      {items.length > 0 ? <View accessibilityLabel={`${items.length} products`} style={styles.productGrid}>{items.map((item) => <ProductCard currencyCode={currencyCode} item={item} key={`${item.productId}:${item.variantId ?? "simple"}`} onPress={() => onProduct(item)} style={useGrid ? styles.productCardGrid : undefined} />)}</View> : null}
    </View>
  );
}

function CategoryChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.categoryChip, active ? styles.categoryChipActive : null, pressed ? styles.pressed : null]}><Text style={[styles.categoryLabel, active ? styles.categoryLabelActive : null]}>{label}</Text></Pressable>;
}

function ProductCard({ currencyCode, item, onPress, style }: { currencyCode: string; item: PosCatalogItem; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const detail = [item.variantName, item.unit, item.sku ? `SKU ${item.sku}` : null].filter(Boolean).join(" · ");
  return <Pressable accessibilityHint="Adds this product to the sale" accessibilityLabel={`${item.productName}, ${formatMoney(item.priceMinor, currencyCode)}`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.productCard, pressed ? styles.pressed : null, style]}><View style={styles.productMark}><Text style={styles.productMarkLabel}>{item.productName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.productCopy}><Text numberOfLines={2} style={styles.productName}>{item.productName}</Text>{detail ? <Text numberOfLines={2} style={styles.productDetail}>{detail}</Text> : null}<View style={styles.signals}>{item.isVariablePrice ? <Text style={styles.signal}>Enter price</Text> : null}{item.hasModifiers ? <Text style={styles.signal}>Options</Text> : null}{item.allowFractionalQuantity ? <Text style={styles.signal}>Fractional</Text> : null}</View></View><Text style={styles.price}>{formatMoney(item.priceMinor, currencyCode)}</Text></Pressable>;
}

const styles = StyleSheet.create({
  catalogue: { gap: tindioTheme.space.md }, heading: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.sm, justifyContent: "space-between" }, headingCopy: { flex: 1, minWidth: 220 },
  eyebrow: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.brand.primary, letterSpacing: 1.2 }, title: { ...tindioTheme.typography.role.title, color: tindioTheme.color.content.primary }, subtitle: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary }, offlineLabel: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.status.success.content },
  scanRow: { alignItems: "flex-end", flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.sm }, scanInput: { flex: 2, minWidth: 220 }, scanActions: { flex: 1, gap: tindioTheme.space.xs, minWidth: 180 }, scannerNote: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.xs }, categoryChip: { borderColor: tindioTheme.color.border.default, borderRadius: tindioTheme.radius.pill, borderWidth: 1, justifyContent: "center", minHeight: tindioTheme.target.minimum, paddingHorizontal: tindioTheme.space.md }, categoryChipActive: { backgroundColor: tindioTheme.color.brand.primary, borderColor: tindioTheme.color.brand.primary }, categoryLabel: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary }, categoryLabelActive: { color: tindioTheme.color.content.inverse },
  productGrid: { flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.sm }, productCard: { ...tindioTheme.shadow.card, alignItems: "center", backgroundColor: tindioTheme.color.surface.card, borderColor: tindioTheme.color.border.default, borderRadius: tindioTheme.radius.lg, borderWidth: 1, flexDirection: "row", gap: tindioTheme.space.sm, minHeight: 104, padding: tindioTheme.space.sm, width: "100%" }, productCardGrid: { flexBasis: "47%", flexGrow: 1 },
  productMark: { alignItems: "center", backgroundColor: tindioTheme.color.brand.cream, borderRadius: tindioTheme.radius.md, height: 52, justifyContent: "center", width: 52 }, productMarkLabel: { ...tindioTheme.typography.role.title, color: tindioTheme.color.brand.primary }, productCopy: { flex: 1, gap: tindioTheme.space.xxs, minWidth: 0 }, productName: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary }, productDetail: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary }, signals: { flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.xxs }, signal: { ...tindioTheme.typography.role.caption, backgroundColor: tindioTheme.color.status.information.surface, borderRadius: tindioTheme.radius.pill, color: tindioTheme.color.status.information.content, overflow: "hidden", paddingHorizontal: tindioTheme.space.xs, paddingVertical: 2 }, price: { ...tindioTheme.typography.role.numeric, color: tindioTheme.color.brand.ink }, pressed: { opacity: 0.8 },
});
