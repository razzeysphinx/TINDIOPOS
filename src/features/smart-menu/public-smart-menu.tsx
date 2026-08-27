import { ImageIcon, SlidersHorizontal } from "lucide-react";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinorMoney } from "@/features/catalog/catalog-money";

const publicMenuVariantSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  price_minor: z.number().int().nonnegative().nullable(),
});

const publicMenuModifierOptionSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  price_minor: z.number().int().nullable(),
});

const publicMenuModifierGroupSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  min_selections: z.number().int().nonnegative(),
  max_selections: z.number().int().positive(),
  options: z.array(publicMenuModifierOptionSchema),
});

const publicMenuProductSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  image_url: z.string().nullable(),
  price_minor: z.number().int().nonnegative().nullable(),
  is_variable_price: z.boolean(),
  available: z.boolean(),
  variants: z.array(publicMenuVariantSchema),
  modifier_groups: z.array(publicMenuModifierGroupSchema),
});

const publicSmartMenuSchema = z.object({
  menu_id: z.uuid(),
  business_name: z.string().min(1),
  store_name: z.string().min(1),
  currency_code: z.string().min(3).max(3),
  show_prices: z.boolean(),
  show_images: z.boolean(),
  show_variants: z.boolean(),
  show_modifiers: z.boolean(),
  categories: z.array(
    z.object({
      id: z.uuid(),
      name: z.string().min(1),
      products: z.array(publicMenuProductSchema),
    }),
  ),
});

export type PublicSmartMenu = z.infer<typeof publicSmartMenuSchema>;

export function parsePublicSmartMenu(value: unknown) {
  return publicSmartMenuSchema.safeParse(value);
}

export function PublicSmartMenuView({ menu }: { menu: PublicSmartMenu }) {
  return (
    <main className="min-h-svh bg-muted/30">
      <section className="border-b bg-background">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
          <p className="text-xs font-semibold tracking-[0.16em] text-primary">TINDIO SMART MENU</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{menu.business_name}</h1>
          <p className="mt-2 text-base text-muted-foreground">{menu.store_name}</p>
          <p className="mt-5 max-w-xl text-sm leading-6 text-muted-foreground">Browse the current menu. Product availability, prices, images, variants, and options are set by this business in TINDIO.</p>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-9 px-5 py-8 sm:px-8 sm:py-12">
        {menu.categories.map((category) => (
          <section aria-labelledby={`menu-category-${category.id}`} key={category.id}>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-xl font-bold" id={`menu-category-${category.id}`}>{category.name}</h2>
              <Badge variant="outline">{category.products.length} item{category.products.length === 1 ? "" : "s"}</Badge>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {category.products.map((product) => <PublicMenuProductCard currencyCode={menu.currency_code} key={product.id} product={product} showImages={menu.show_images} showModifiers={menu.show_modifiers} showPrices={menu.show_prices} showVariants={menu.show_variants} />)}
            </div>
          </section>
        ))}
        {menu.categories.length === 0 ? <Card><CardHeader className="items-center py-12 text-center"><CardTitle>This menu is being updated</CardTitle><CardDescription>Please check back shortly for the current selection.</CardDescription></CardHeader></Card> : null}
      </div>
    </main>
  );
}

function PublicMenuProductCard({
  product,
  currencyCode,
  showImages,
  showPrices,
  showVariants,
  showModifiers,
}: {
  product: z.infer<typeof publicMenuProductSchema>;
  currencyCode: string;
  showImages: boolean;
  showPrices: boolean;
  showVariants: boolean;
  showModifiers: boolean;
}) {
  const backgroundImage = showImages ? safeBackgroundImage(product.image_url) : undefined;
  const hasDetails = (showVariants && product.variants.length > 0) || (showModifiers && product.modifier_groups.length > 0);

  return (
    <Card className={!product.available ? "opacity-70" : undefined}>
      {showImages ? <div aria-hidden="true" className="grid aspect-[16/9] place-items-center rounded-t-xl border-b bg-muted text-muted-foreground" style={backgroundImage ? { backgroundImage, backgroundPosition: "center", backgroundSize: "cover" } : undefined}>{backgroundImage ? null : <ImageIcon className="size-8" />}</div> : null}
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-lg">{product.name}</CardTitle>
          {!product.available ? <Badge variant="outline">Sold out</Badge> : null}
        </div>
        {product.description ? <CardDescription>{product.description}</CardDescription> : null}
        {showPrices ? <p className="font-semibold text-primary">{product.is_variable_price ? "Variable price" : formatMinorMoney(product.price_minor ?? 0, currencyCode)}</p> : null}
      </CardHeader>
      {hasDetails ? (
        <CardContent>
          <details className="group rounded-lg border p-3">
            <summary className="cursor-pointer list-none text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2"><SlidersHorizontal className="size-4" aria-hidden="true" /> Product details</span>
            </summary>
            <div className="mt-4 space-y-4 border-t pt-4 text-sm">
              {showVariants && product.variants.length > 0 ? <VariantList currencyCode={currencyCode} showPrices={showPrices} variants={product.variants} /> : null}
              {showModifiers && product.modifier_groups.length > 0 ? <ModifierList currencyCode={currencyCode} showPrices={showPrices} groups={product.modifier_groups} /> : null}
            </div>
          </details>
        </CardContent>
      ) : null}
    </Card>
  );
}

function VariantList({ variants, currencyCode, showPrices }: { variants: z.infer<typeof publicMenuVariantSchema>[]; currencyCode: string; showPrices: boolean }) {
  return <section><p className="font-medium">Variants</p><ul className="mt-2 space-y-1.5 text-muted-foreground">{variants.map((variant) => <li className="flex justify-between gap-3" key={variant.id}><span>{variant.name}</span>{showPrices && variant.price_minor !== null ? <span>{formatMinorMoney(variant.price_minor, currencyCode)}</span> : null}</li>)}</ul></section>;
}

function ModifierList({ groups, currencyCode, showPrices }: { groups: z.infer<typeof publicMenuModifierGroupSchema>[]; currencyCode: string; showPrices: boolean }) {
  return <section className="space-y-3"><p className="font-medium">Available options</p>{groups.map((group) => <div key={group.id}><p className="text-muted-foreground">{group.name} <span className="text-xs">({group.min_selections === group.max_selections ? `choose ${group.min_selections}` : `${group.min_selections}–${group.max_selections} choices`})</span></p><ul className="mt-1.5 space-y-1 text-muted-foreground">{group.options.map((option) => <li className="flex justify-between gap-3" key={option.id}><span>{option.name}</span>{showPrices && option.price_minor !== null && option.price_minor !== 0 ? <span>+{formatMinorMoney(option.price_minor, currencyCode)}</span> : null}</li>)}</ul></div>)}</section>;
}

function safeBackgroundImage(imageUrl: string | null) {
  if (!imageUrl) return undefined;
  try {
    const url = new URL(imageUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? `url("${url.toString().replaceAll('"', "%22")}")` : undefined;
  } catch {
    return undefined;
  }
}
