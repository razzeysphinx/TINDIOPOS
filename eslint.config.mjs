import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "supabase/.temp/**",
    "next-env.d.ts",
  ]),
  {
    // Client-side boundary: UI/client modules must not import backend-only
    // internals (server Supabase client, DAL, feature data/service layers,
    // and other privileged server helpers). Approved client boundaries are
    // "use server" action modules, client-safe facades, and shared types/
    // schema/constant modules.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: [
      // Server contexts that legitimately use the server stack:
      "src/app/**",
      "src/proxy.ts",
      // Server-stack wiring inside src/lib:
      "src/lib/**",
      // Backend service/data layers ("use server" entry points and
      // server-only read/command modules):
      "src/features/**/actions.ts",
      "src/features/**/ticket-actions.ts",
      "src/features/**/improvement-6-actions.ts",
      "src/features/**/supply-chain-actions.ts",
      "src/features/**/advanced-inventory-actions.ts",
      "src/features/**/data.ts",
      "src/features/**/service.ts",
      // Backend modules whose filename does not follow the data/service
      // convention but which carry "import \"server-only\"":
      "src/features/reports/reporting.ts",
      "src/features/checkout/checkout-service.ts",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/supabase/server",
                "@/lib/supabase/proxy",
                // Browser Supabase access goes through the realtime facade:
                "@/lib/supabase/client",
                "@/lib/auth/dal",
                "@/features/*/data",
                "@/features/*/service",
                "@/features/reports/reporting",
                "@/features/checkout/checkout-service",
                "@/features/management/invitation-token",
                "@/features/customer-display/customer-display-token",
              ],
              message:
                "Backend-only module. Client code must go through 'use server' actions, API routes, or client-safe facades/shared contracts.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    // Server-side boundary: data/service layers must not depend on the
    // presentation layer (React UI components, icons, or feature view
    // modules following this repository's UI naming conventions).
    files: [
      "src/features/**/data.ts",
      "src/features/**/service.ts",
      "src/lib/server/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/components/**",
                "react",
                "react-dom",
                "lucide-react",
                "@/features/*/*-forms",
                "@/features/*/*-form",
                "@/features/*/*-manager",
                "@/features/*/*-dialog",
                "@/features/*/*-display",
                "@/features/*/*-screen",
                "@/features/*/*-workflows",
                "@/features/*/*-terminal",
                "@/features/*/*-picker",
                "@/features/*/*-button",
                "@/features/*/*-switcher",
              ],
              message:
                "Server data/service layers must not import presentation/UI modules.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
