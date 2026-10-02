# R7 Catalog Historical Timestamp Preservation

Status: **IMPLEMENTED — narrow target-only historical maintenance scope**

Inserting a product invokes `private.initialize_product_base_unit()` and creates the canonical base `product_units` row with a generated UUID and current timestamps. `private.protect_product_unit_identity()` correctly prevents deleting the base row or changing its organization, product, base flag, unit code, or factor.

The R7 in-place reconciliation successfully preserved the authoritative source UUID, relationship, immutable identity, `created_at`, and business fields. The only remaining mismatch was `updated_at`, because the non-internal `product_units_set_updated_at` trigger invokes `private.set_updated_at()` and unconditionally assigns `now()` on updates.

Target inspection found seven `product_units` triggers: four internal FK triggers, the organization operational guard, base-unit identity protection, and one timestamp-maintenance trigger. All were enabled. No existing historical-import context exists.

The packet-authorized solution discovers and verifies exactly one allowlisted trigger on `public.product_units` whose function is `private.set_updated_at()`. In one target transaction it disables only that exact timestamp trigger, reconciles the known canonical row, re-enables the trigger, and verifies timestamp, identity protection, operational guard, trigger state, and definition before commit. FK/system, base-unit, and operational guards remain enabled throughout.
