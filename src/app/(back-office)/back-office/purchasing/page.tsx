import {
  InventoryWorkspacePage,
  type InventoryWorkspacePageProps,
} from "@/app/(back-office)/back-office/inventory/page";

export const metadata = { title: "Purchasing" };

/**
 * Purchasing intentionally shares the Inventory server loader. This is a
 * route-level separation only: purchasing keeps the canonical supplier,
 * purchase-order, receiving, inventory-ledger, permission, and store-scope
 * implementations.
 */
export default function PurchasingPage(props: InventoryWorkspacePageProps) {
  return <InventoryWorkspacePage {...props} workspace="purchasing" />;
}
