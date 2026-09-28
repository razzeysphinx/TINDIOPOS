import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const read = (path) => fs.readFileSync(path, "utf8");
test("Phase 06 device enrollment is bearer-authenticated and secret-safe", () => { const route = read("src/app/api/pos/v2/device/enroll/route.ts"); const mobile = read("apps/mobile/src/lib/tindio-api.ts") + read("apps/mobile/src/features/device/device-store.ts") + read("apps/mobile/src/features/device/device-setup.tsx"); for (const value of ["getPosV2BusinessContext", "devices.manage", "register_pos_device", "createBusinessContextClient"]) assert.ok(route.includes(value)); for (const value of ["expo-crypto", "secureStorage", "/api/pos/v2/device/enroll", "/api/pos/v2/device", "devices.manage"]) assert.ok(mobile.includes(value)); for (const secret of ["service_role", "DATABASE_URL", "NEON_DATA_API_URL", "x-vercel-protection-bypass"]) assert.ok(!mobile.includes(secret)); });
