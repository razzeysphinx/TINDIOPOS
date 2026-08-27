export type SmartMenuActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string };

export type SmartMenuStore = {
  id: string;
  name: string;
};

export type SmartMenuCategory = {
  id: string;
  name: string;
};

export type SmartMenuProduct = {
  id: string;
  categoryId: string;
  name: string;
  imageUrl: string | null;
};

export type SmartMenuConfiguration = {
  menuId: string | null;
  storeId: string;
  isEnabled: boolean;
  showPrices: boolean;
  showImages: boolean;
  showUnavailable: boolean;
  showVariants: boolean;
  showModifiers: boolean;
  categoryIds: string[];
  productIds: string[];
};

export type SmartMenuWorkspace = {
  stores: SmartMenuStore[];
  categories: SmartMenuCategory[];
  products: SmartMenuProduct[];
  configurations: SmartMenuConfiguration[];
};
