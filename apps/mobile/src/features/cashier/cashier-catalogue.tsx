import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import type { PosCatalogItem, PosCategory } from "../../../../../src/contracts/pos";

import { TindioButton } from "../../ui/tindio-button";
import { TindioFeedback } from "../../ui/tindio-feedback";
import { TindioInput } from "../../ui/tindio-input";
import { tindioTheme } from "../../ui/theme";
import { useTindioResponsiveLayout } from "../../ui/tindio-responsive";
import { formatMoney } from "./cashier-format";

type CashierCatalogueProps = {
  categories: PosCategory[]; categoryId: string | null; currencyCode: string; error: string | null;
  items: PosCatalogItem[]; loading: boolean; lookup: string; query: string; storeName: string;
  onCategory: (categoryId: string | null) => void; onFindBarcode: () => void; onLookupChange: (value: string) => void;
  onOpenCamera: () => void; onProduct: (item: PosCatalogItem) => void; onQueryChange: (value: string) => void;
};

export function CashierCatalogue({ categories, categoryId, currencyCode, error, items, loading, lookup, onCategory, onFindBarcode, onLookupChange, onOpenCamera, onProduct, onQueryChange, query, storeName }: CashierCatalogueProps) {
  const { allowsDenseGrid, isLargeText } = useTindioResponsiveLayout();
  return (
    <View style={styles.catalogue} testID="cashier-catalogue">
      <View style={styles.heading}><View style={styles.headingCopy}><Text accessibilityRole="header" style={styles.title}>{storeName}</Text><Text style={styles.subtitle}>Select an item or scan a barcode to add it to this sale.</Text></View><View style={styles.offlinePill}><View style={styles.offlineDot} /><Text style={styles.offlineLabel}>Products available offline</Text></View></View>
      <TindioInput accessibilityLabel="Search products" label="Search products, SKU, or barcode" onChangeText={onQueryChange} placeholder="Start typing to search the catalogue" returnKeyType="search" value={query} />
      <View style={styles.scanRow}><View style={styles.scanInput}><TindioInput accessibilityLabel="Barcode or SKU" autoCapitalize="none" autoCorrect={false} label="Quick barcode entry" onChangeText={onLookupChange} onSubmitEditing={onFindBarcode} placeholder="Enter barcode or SKU" returnKeyType="search" value={lookup} /></View><View style={styles.scanActions}><TindioButton onPress={onFindBarcode} variant="secondary">Find item</TindioButton><TindioButton onPress={onOpenCamera} variant="ghost">Scan camera</TindioButton></View></View>
      <View accessibilityRole="tablist" style={styles.categories}><CategoryChip active={categoryId === null} label="All items" onPress={() => onCategory(null)} />{categories.map((category) => <CategoryChip active={categoryId === category.id} key={category.id} label={category.name} onPress={() => onCategory(category.id)} />)}</View>
      {error ? <TindioFeedback description={error} kind="error" title="Products unavailable" /> : null}
      {loading && items.length === 0 ? <TindioFeedback description="Loading products saved on this device." kind="loading" title="Opening catalogue" /> : null}
      {!loading && !error && items.length === 0 ? <EmptyCatalogue filtered={Boolean(query || categoryId)} /> : null}
      {items.length > 0 ? <View accessibilityLabel={`${items.length} products`} style={styles.productGrid}>{items.map((item) => <ProductCard currencyCode={currencyCode} item={item} key={`${item.productId}:${item.variantId ?? "simple"}`} largeText={isLargeText} onPress={() => onProduct(item)} style={allowsDenseGrid ? styles.productCardGrid : undefined} />)}</View> : null}
    </View>
  );
}

function EmptyCatalogue({ filtered }: { filtered: boolean }) {
  return (
    <View style={styles.empty}>
      <View accessibilityElementsHidden style={styles.emptyMark}><Text style={styles.emptyMarkLabel}>□</Text></View>
      <Text style={styles.emptyTitle}>{filtered ? "No products found" : "No saleable products yet"}</Text>
      <Text style={styles.emptyDescription}>
        {filtered ? "Try a different product name, SKU, barcode, or category." : "Create and enable products for this store in the Back Office catalogue."}
      </Text>
    </View>
  );
}

function CategoryChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.categoryChip, active ? styles.categoryChipActive : null, pressed ? styles.pressed : null]}><Text style={[styles.categoryLabel, active ? styles.categoryLabelActive : null]}>{label}</Text></Pressable>;
}

function ProductCard({ currencyCode, item, largeText, onPress, style }: { currencyCode: string; item: PosCatalogItem; largeText: boolean; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const detail = [item.variantName, item.unit, item.sku ? `SKU ${item.sku}` : null].filter(Boolean).join(" · ");
  return <Pressable accessibilityHint="Adds this product to the sale" accessibilityLabel={`${item.productName}, ${formatMoney(item.priceMinor, currencyCode)}`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.productCard, largeText ? styles.productCardLargeText : null, pressed ? styles.pressed : null, style]}><View accessibilityElementsHidden style={styles.productMark}><Text style={styles.productMarkLabel}>{item.productName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.productCopy}><Text numberOfLines={largeText ? undefined : 2} style={styles.productName}>{item.productName}</Text>{detail ? <Text numberOfLines={largeText ? undefined : 2} style={styles.productDetail}>{detail}</Text> : null}<View style={styles.signals}>{item.isVariablePrice ? <Text style={styles.signal}>Enter price</Text> : null}{item.hasModifiers ? <Text style={styles.signal}>Options</Text> : null}{item.allowFractionalQuantity ? <Text style={styles.signal}>Fractional</Text> : null}</View></View><Text style={styles.price}>{formatMoney(item.priceMinor, currencyCode)}</Text></Pressable>;
}

const styles = StyleSheet.create({
  catalogue: { gap: tindioTheme.space.md }, heading: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.sm, justifyContent: "space-between" }, headingCopy: { flex: 1, minWidth: 220 },
  title: { ...tindioTheme.typography.role.section, color: tindioTheme.color.content.primary }, subtitle: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary, marginTop: tindioTheme.space.xxs }, offlinePill: { alignItems: "center", backgroundColor: tindioTheme.color.status.success.surface, borderRadius: tindioTheme.radius.pill, flexDirection: "row", gap: tindioTheme.space.xxs, paddingHorizontal: tindioTheme.space.sm, paddingVertical: tindioTheme.space.xxs }, offlineDot: { backgroundColor: tindioTheme.color.status.success.content, borderRadius: 4, height: 7, width: 7 }, offlineLabel: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.status.success.content },
  scanRow: { alignItems: "flex-end", flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.sm }, scanInput: { flex: 2, minWidth: 220 }, scanActions: { flex: 1, gap: tindioTheme.space.xs, minWidth: 160 },
  categories: { borderBottomColor: tindioTheme.color.border.default, borderBottomWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.xs, paddingBottom: tindioTheme.space.sm }, categoryChip: { borderColor: tindioTheme.color.border.default, borderRadius: tindioTheme.radius.pill, borderWidth: 1, justifyContent: "center", minHeight: tindioTheme.target.minimum, paddingHorizontal: tindioTheme.space.md }, categoryChipActive: { backgroundColor: tindioTheme.color.status.success.surface, borderColor: tindioTheme.color.status.success.border }, categoryLabel: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary }, categoryLabelActive: { color: tindioTheme.color.status.success.content },
  empty: { alignItems: "center", justifyContent: "center", minHeight: 280, padding: tindioTheme.space.xl }, emptyMark: { alignItems: "center", backgroundColor: tindioTheme.color.surface.card, borderRadius: tindioTheme.radius.pill, height: 52, justifyContent: "center", width: 52 }, emptyMarkLabel: { color: tindioTheme.color.content.secondary, fontSize: 30, lineHeight: 32 }, emptyTitle: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary, marginTop: tindioTheme.space.md, textAlign: "center" }, emptyDescription: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary, marginTop: tindioTheme.space.xs, maxWidth: 340, textAlign: "center" },
  productGrid: { flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.sm }, productCard: { alignItems: "center", backgroundColor: tindioTheme.color.surface.card, borderColor: tindioTheme.color.border.default, borderRadius: tindioTheme.radius.md, borderWidth: 1, flexDirection: "row", gap: tindioTheme.space.sm, minHeight: 96, padding: tindioTheme.space.sm, width: "100%" }, productCardGrid: { flexBasis: "47%", flexGrow: 1 }, productCardLargeText: { alignItems: "flex-start", flexDirection: "column" },
  productMark: { alignItems: "center", backgroundColor: tindioTheme.color.brand.cream, borderRadius: tindioTheme.radius.md, height: 52, justifyContent: "center", width: 52 }, productMarkLabel: { ...tindioTheme.typography.role.title, color: tindioTheme.color.brand.primary }, productCopy: { flex: 1, gap: tindioTheme.space.xxs, minWidth: 0 }, productName: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary }, productDetail: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary }, signals: { flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.xxs }, signal: { ...tindioTheme.typography.role.caption, backgroundColor: tindioTheme.color.status.information.surface, borderRadius: tindioTheme.radius.pill, color: tindioTheme.color.status.information.content, overflow: "hidden", paddingHorizontal: tindioTheme.space.xs, paddingVertical: 2 }, price: { ...tindioTheme.typography.role.numeric, color: tindioTheme.color.brand.ink }, pressed: { opacity: 0.8 },
});
