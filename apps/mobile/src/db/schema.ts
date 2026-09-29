export const TINDIO_DATABASE_NAME = "tindio-mobile.db";
export const TINDIO_LOCAL_SCHEMA_VERSION = 5;

export type LocalMigration = {
  version: number;
  name: string;
  sql: string;
};

export const LOCAL_MIGRATIONS: LocalMigration[] = [
  {
    version: 1,
    name: "phase_07a_core",
    sql: `CREATE TABLE IF NOT EXISTS local_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS business_context_snapshots (organization_id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, employee_id TEXT NOT NULL, organization_json TEXT NOT NULL, employee_json TEXT NOT NULL, available_organizations_json TEXT NOT NULL, role_names_json TEXT NOT NULL, permissions_json TEXT NOT NULL, store_ids_json TEXT NOT NULL, stores_json TEXT NOT NULL, registers_json TEXT NOT NULL, features_json TEXT NOT NULL, active_shift_json TEXT, captured_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_business_context_employee ON business_context_snapshots (employee_id);`,
  },
  {
    version: 2,
    name: "phase_07_complete_foundation",
    sql: `
      CREATE TABLE IF NOT EXISTS local_cache_state (
        organization_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        store_id TEXT NOT NULL DEFAULT '',
        scope_key TEXT NOT NULL DEFAULT '',
        source_version TEXT,
        record_count INTEGER NOT NULL DEFAULT 0,
        is_complete INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0, 1)),
        captured_at TEXT NOT NULL,
        PRIMARY KEY (organization_id, domain, store_id, scope_key)
      );
      CREATE TABLE IF NOT EXISTS reference_snapshots (
        organization_id TEXT PRIMARY KEY NOT NULL,
        reference_version TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS catalog_items (
        organization_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        item_key TEXT NOT NULL,
        product_id TEXT NOT NULL,
        variant_id TEXT,
        category_id TEXT,
        product_name TEXT NOT NULL,
        variant_name TEXT,
        sku TEXT,
        barcode TEXT,
        price_minor INTEGER NOT NULL,
        unit TEXT NOT NULL,
        image_url TEXT,
        is_variable_price INTEGER NOT NULL CHECK (is_variable_price IN (0, 1)),
        allow_fractional_quantity INTEGER NOT NULL CHECK (allow_fractional_quantity IN (0, 1)),
        has_modifiers INTEGER NOT NULL CHECK (has_modifiers IN (0, 1)),
        payload_json TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        PRIMARY KEY (organization_id, store_id, item_key)
      );
      CREATE INDEX IF NOT EXISTS idx_catalog_lookup_barcode ON catalog_items (organization_id, store_id, barcode);
      CREATE INDEX IF NOT EXISTS idx_catalog_lookup_sku ON catalog_items (organization_id, store_id, sku);
      CREATE INDEX IF NOT EXISTS idx_catalog_category ON catalog_items (organization_id, store_id, category_id);
      CREATE INDEX IF NOT EXISTS idx_catalog_product_name ON catalog_items (organization_id, store_id, product_name COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS customer_cache (
        organization_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        customer_number INTEGER NOT NULL,
        loyalty_card_code TEXT NOT NULL,
        full_name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        loyalty_points INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        PRIMARY KEY (organization_id, store_id, customer_id)
      );
      CREATE INDEX IF NOT EXISTS idx_customer_number ON customer_cache (organization_id, store_id, customer_number);
      CREATE INDEX IF NOT EXISTS idx_customer_loyalty_card ON customer_cache (organization_id, store_id, loyalty_card_code);
      CREATE TABLE IF NOT EXISTS shift_snapshots (
        organization_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        register_id TEXT NOT NULL,
        shift_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        PRIMARY KEY (organization_id, store_id, register_id)
      );
      CREATE TABLE IF NOT EXISTS receipt_summaries (
        organization_id TEXT NOT NULL,
        receipt_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        register_id TEXT NOT NULL,
        receipt_number INTEGER NOT NULL,
        issued_at TEXT NOT NULL,
        total_minor INTEGER NOT NULL,
        currency_code TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        PRIMARY KEY (organization_id, receipt_id)
      );
      CREATE INDEX IF NOT EXISTS idx_receipt_store_number ON receipt_summaries (organization_id, store_id, receipt_number DESC);
    `,
  },
  { version: 3, name: "phase_09_local_first", sql: `ALTER TABLE catalog_items ADD COLUMN search_text TEXT NOT NULL DEFAULT ''; UPDATE catalog_items SET search_text = lower(trim(coalesce(product_name,'') || ' ' || coalesce(variant_name,'') || ' ' || coalesce(sku,'') || ' ' || coalesce(barcode,''))); CREATE INDEX IF NOT EXISTS idx_catalog_search_text ON catalog_items (organization_id,store_id,search_text); CREATE TABLE IF NOT EXISTS modifier_snapshots (organization_id TEXT NOT NULL,store_id TEXT NOT NULL,product_id TEXT NOT NULL,payload_json TEXT NOT NULL,captured_at TEXT NOT NULL,PRIMARY KEY (organization_id,store_id,product_id)); CREATE TABLE IF NOT EXISTS stock_estimates (organization_id TEXT NOT NULL,store_id TEXT NOT NULL,product_id TEXT NOT NULL,variant_id TEXT NOT NULL DEFAULT '',available_quantity REAL NOT NULL,checked_at TEXT NOT NULL,source TEXT NOT NULL CHECK (source IN ('server-stock-validation')),PRIMARY KEY (organization_id,store_id,product_id,variant_id)); CREATE INDEX IF NOT EXISTS idx_stock_estimates_checked ON stock_estimates (organization_id,store_id,checked_at DESC);` },
  { version: 4, name: "phase_10_durable_outbox", sql: `CREATE TABLE IF NOT EXISTS outbox_events (event_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,store_id TEXT NOT NULL,register_id TEXT NOT NULL,device_id TEXT NOT NULL,shift_id TEXT NOT NULL,operation_type TEXT NOT NULL CHECK(operation_type IN ('SALE_COMPLETED')),idempotency_key TEXT NOT NULL,local_reference TEXT NOT NULL,payload_json TEXT NOT NULL,snapshot_json TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('LOCAL_PENDING','SYNCING','SYNCED','CONFLICT','FAILED')),attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_attempt_at TEXT,next_retry_at TEXT,synced_at TEXT,last_error TEXT,conflict_type TEXT,server_sale_id TEXT,official_receipt_number INTEGER,UNIQUE(organization_id,idempotency_key)); CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(organization_id,state,created_at); CREATE INDEX IF NOT EXISTS idx_outbox_terminal ON outbox_events(organization_id,store_id,register_id,device_id,created_at); CREATE INDEX IF NOT EXISTS idx_outbox_retry ON outbox_events(organization_id,state,next_retry_at);` },
  { version: 5, name: "phase_11_device_sequence_checkpoints", sql: `WITH ranked AS (SELECT event_id,ROW_NUMBER() OVER (PARTITION BY organization_id,device_id ORDER BY created_at ASC,event_id ASC) AS sequence_value FROM outbox_events WHERE device_sequence IS NULL) UPDATE outbox_events SET device_sequence=(SELECT sequence_value FROM ranked WHERE ranked.event_id=outbox_events.event_id) WHERE device_sequence IS NULL; CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_device_sequence ON outbox_events(organization_id,device_id,device_sequence); CREATE TABLE IF NOT EXISTS device_sync_state (organization_id TEXT NOT NULL,device_id TEXT NOT NULL,next_sequence INTEGER NOT NULL CHECK(next_sequence >= 1),server_checkpoint INTEGER NOT NULL DEFAULT 0 CHECK(server_checkpoint >= 0),checkpoint_observed_at TEXT,last_server_status TEXT,PRIMARY KEY(organization_id,device_id));` },
];
