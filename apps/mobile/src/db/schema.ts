export const TINDIO_DATABASE_NAME = "tindio-mobile.db";
export const TINDIO_LOCAL_SCHEMA_VERSION = 12;

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
  { version: 6, name: "phase_12_delta_sync", sql: `CREATE TABLE IF NOT EXISTS sync_cursors (organization_id TEXT NOT NULL,device_id TEXT NOT NULL,store_id TEXT NOT NULL,pull_cursor INTEGER NOT NULL DEFAULT 0 CHECK(pull_cursor >= 0),initialized INTEGER NOT NULL DEFAULT 0 CHECK(initialized IN (0,1)),last_push_at TEXT,last_pull_at TEXT,last_reconcile_at TEXT,last_error TEXT,PRIMARY KEY(organization_id,device_id,store_id)); CREATE INDEX IF NOT EXISTS idx_sync_cursors_org_store ON sync_cursors(organization_id,store_id);` },
  { version: 7, name: "phase_15_store_hub", sql: `CREATE TABLE IF NOT EXISTS store_hub_state (organization_id TEXT NOT NULL,store_id TEXT NOT NULL,device_id TEXT NOT NULL,hub_url TEXT NOT NULL,pull_cursor INTEGER NOT NULL DEFAULT 0 CHECK(pull_cursor >= 0),last_contact_at TEXT,last_error TEXT,PRIMARY KEY(organization_id,store_id,device_id)); CREATE TABLE IF NOT EXISTS store_hub_events (organization_id TEXT NOT NULL,store_id TEXT NOT NULL,event_id TEXT NOT NULL,device_id TEXT NOT NULL,device_sequence INTEGER NOT NULL CHECK(device_sequence >= 1),hub_revision INTEGER NOT NULL CHECK(hub_revision >= 1),event_type TEXT NOT NULL CHECK(event_type IN ('SALE_COMPLETED')),created_at TEXT NOT NULL,cloud_synced_at TEXT,local_reference TEXT NOT NULL,items_json TEXT NOT NULL,received_at TEXT NOT NULL,PRIMARY KEY(organization_id,store_id,event_id)); CREATE INDEX IF NOT EXISTS idx_store_hub_events_device ON store_hub_events(organization_id,store_id,device_id,device_sequence); CREATE INDEX IF NOT EXISTS idx_store_hub_events_revision ON store_hub_events(organization_id,store_id,hub_revision); CREATE TABLE IF NOT EXISTS store_hub_publish_state (organization_id TEXT NOT NULL,store_id TEXT NOT NULL,event_id TEXT NOT NULL,outbox_state TEXT NOT NULL,cloud_synced_at TEXT,published_at TEXT NOT NULL,PRIMARY KEY(organization_id,store_id,event_id));` },
  {
    version: 8,
    name: "mob_05_catalog_cache_repair",
    sql: `
      UPDATE catalog_items
      SET
        product_id = json_extract(payload_json, '$.productId'),
        variant_id = json_extract(payload_json, '$.variantId'),
        category_id = json_extract(payload_json, '$.categoryId'),
        product_name = json_extract(payload_json, '$.productName'),
        variant_name = json_extract(payload_json, '$.variantName'),
        sku = json_extract(payload_json, '$.sku'),
        barcode = json_extract(payload_json, '$.barcode'),
        price_minor = CAST(json_extract(payload_json, '$.priceMinor') AS INTEGER),
        unit = json_extract(payload_json, '$.unit'),
        image_url = json_extract(payload_json, '$.imageUrl'),
        is_variable_price = CASE json_extract(payload_json, '$.isVariablePrice') WHEN 1 THEN 1 ELSE 0 END,
        allow_fractional_quantity = CASE json_extract(payload_json, '$.allowFractionalQuantity') WHEN 1 THEN 1 ELSE 0 END,
        has_modifiers = CASE json_extract(payload_json, '$.hasModifiers') WHEN 1 THEN 1 ELSE 0 END,
        search_text = lower(trim(
          coalesce(json_extract(payload_json, '$.productName'), '') || ' ' ||
          coalesce(json_extract(payload_json, '$.variantName'), '') || ' ' ||
          coalesce(json_extract(payload_json, '$.sku'), '') || ' ' ||
          coalesce(json_extract(payload_json, '$.barcode'), '')
        ))
      WHERE json_valid(payload_json)
        AND json_type(payload_json, '$.productId') = 'text'
        AND json_type(payload_json, '$.productName') = 'text'
        AND json_type(payload_json, '$.priceMinor') IN ('integer', 'real')
        AND json_type(payload_json, '$.unit') = 'text';
    `,
  },
  {
    version: 9,
    name: "mob_01_durable_online_checkout_intents",
    sql: `
      CREATE TABLE IF NOT EXISTS checkout_intents (
        intent_id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        register_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        shift_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('PREPARED','SUBMITTING','UNKNOWN','ACKNOWLEDGED','REJECTED')),
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_attempt_at TEXT,
        last_error TEXT,
        server_sale_id TEXT,
        official_receipt_number INTEGER,
        UNIQUE (organization_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_checkout_intents_unresolved
        ON checkout_intents (organization_id, device_id, state, created_at);
    `,
  },
  {
    version: 10,
    name: "mob_04_outbox_recovery_audit",
    sql: `
      CREATE TABLE IF NOT EXISTS outbox_recovery_actions (
        action_id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        actor_profile_id TEXT NOT NULL,
        actor_employee_id TEXT NOT NULL,
        prior_state TEXT NOT NULL CHECK (prior_state IN ('FAILED','CONFLICT')),
        prior_error TEXT,
        prior_conflict_type TEXT,
        action TEXT NOT NULL CHECK (action IN ('RETRY_AUTHORIZED')),
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (event_id) REFERENCES outbox_events(event_id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_recovery_event
        ON outbox_recovery_actions (organization_id, event_id, created_at);
    `,
  },
  {
    version: 11,
    name: "mob_07_immutable_local_receipts",
    sql: `
      CREATE TABLE IF NOT EXISTS local_receipts (
        event_id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        register_id TEXT NOT NULL,
        local_reference TEXT NOT NULL,
        snapshot_version INTEGER NOT NULL CHECK (snapshot_version IN (1,2)),
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        server_sale_id TEXT,
        official_receipt_number INTEGER,
        linked_at TEXT,
        FOREIGN KEY (event_id) REFERENCES outbox_events(event_id) ON DELETE RESTRICT,
        CHECK ((server_sale_id IS NULL AND official_receipt_number IS NULL AND linked_at IS NULL) OR
               (server_sale_id IS NOT NULL AND official_receipt_number IS NOT NULL AND linked_at IS NOT NULL))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_local_receipt_official_sale
        ON local_receipts (organization_id, server_sale_id) WHERE server_sale_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_local_receipt_official_number
        ON local_receipts (organization_id, official_receipt_number) WHERE official_receipt_number IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_local_receipt_store_created
        ON local_receipts (organization_id, store_id, created_at DESC);
      INSERT OR IGNORE INTO local_receipts
        (event_id,organization_id,store_id,register_id,local_reference,snapshot_version,snapshot_json,created_at,server_sale_id,official_receipt_number,linked_at)
      SELECT event_id,organization_id,store_id,register_id,local_reference,
        CASE WHEN json_valid(snapshot_json) THEN
          CASE WHEN json_extract(snapshot_json,'$.version')=2 THEN 2 ELSE 1 END
        ELSE 1 END,
        snapshot_json,created_at,
        CASE WHEN server_sale_id IS NOT NULL AND official_receipt_number IS NOT NULL THEN server_sale_id ELSE NULL END,
        CASE WHEN server_sale_id IS NOT NULL AND official_receipt_number IS NOT NULL THEN official_receipt_number ELSE NULL END,
        CASE WHEN server_sale_id IS NOT NULL AND official_receipt_number IS NOT NULL THEN coalesce(synced_at,updated_at) ELSE NULL END
      FROM outbox_events;
      CREATE TRIGGER IF NOT EXISTS trg_local_receipt_snapshot_immutable
      BEFORE UPDATE OF snapshot_json,snapshot_version,event_id,organization_id,store_id,register_id,local_reference,created_at ON local_receipts
      BEGIN SELECT RAISE(ABORT, 'local receipt snapshot is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS trg_local_receipt_custody
      BEFORE DELETE ON local_receipts
      BEGIN SELECT RAISE(ABORT, 'local receipt custody is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS trg_local_receipt_official_link_once
      BEFORE UPDATE OF server_sale_id,official_receipt_number,linked_at ON local_receipts
      WHEN OLD.server_sale_id IS NOT NULL OR OLD.official_receipt_number IS NOT NULL OR OLD.linked_at IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'official receipt link is immutable'); END;
      CREATE TABLE IF NOT EXISTS receipt_copy_jobs (
        job_id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        copy_number INTEGER NOT NULL CHECK (copy_number >= 1),
        document_kind TEXT NOT NULL CHECK (document_kind IN ('PROVISIONAL','OFFICIAL')),
        state TEXT NOT NULL CHECK (state IN ('PREPARED','COMPLETED','FAILED')),
        requested_by_profile_id TEXT NOT NULL,
        requested_by_employee_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        last_error TEXT,
        FOREIGN KEY (event_id) REFERENCES local_receipts(event_id) ON DELETE RESTRICT,
        UNIQUE (organization_id,event_id,copy_number)
      );
      CREATE INDEX IF NOT EXISTS idx_receipt_copy_history
        ON receipt_copy_jobs (organization_id,event_id,copy_number DESC);
    `,
  },
  {
    version: 12,
    name: "mob_08_shift_finalization_guard",
    sql: `
      CREATE TABLE IF NOT EXISTS shift_finalization_guards (
        organization_id TEXT NOT NULL,
        shift_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        register_id TEXT NOT NULL,
        finalization_token TEXT NOT NULL,
        local_high_water INTEGER NOT NULL CHECK (local_high_water >= 0),
        state TEXT NOT NULL CHECK (state IN ('FINALIZING','CLOSED')),
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT,
        PRIMARY KEY (organization_id, shift_id),
        UNIQUE (organization_id, finalization_token)
      );
      CREATE INDEX IF NOT EXISTS idx_shift_finalization_guard_device
        ON shift_finalization_guards (organization_id, device_id, state);
    `,
  },
];
