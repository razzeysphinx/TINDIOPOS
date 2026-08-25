import { getBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const exportSections = [
  "organization",
  "stores",
  "registers",
  "employees",
  "roles",
  "categories",
  "products",
  "product_variants",
  "customers",
  "payment_methods",
  "sales",
  "sale_items",
  "payments",
  "receipts",
  "refunds",
  "inventory_movements",
  "purchase_orders",
  "stock_transfers",
  "offline_sync_events",
] as const;

type PreparedExport = {
  allowed?: boolean;
  export_session_id?: string;
  retry_after_seconds?: number;
};

type ExportPage = {
  records?: unknown[];
  next_after_id?: string | null;
};

type ExportManifest = {
  exportedAt: string;
  format: "tindio-organization-ndjson-v2";
  sections: Record<string, number>;
};

function safeFileSegment(value: string) {
  return value
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80) || "organization";
}

export async function GET() {
  const context = await getBusinessContext();

  if (!context) {
    return Response.json({ message: "Sign in before exporting an organization." }, { status: 401 });
  }

  if (!context.tenantReadiness.canExport) {
    return Response.json(
      { message: "Only an owner or administrator can export this organization." },
      { status: 403 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prepare_organization_export", {
    target_organization_id: context.organization.id,
  });

  if (error) {
    return Response.json(
      { message: error.code === "42501" ? "You do not have permission to export this organization." : "TINDIO could not prepare this export." },
      { status: error.code === "42501" ? 403 : 500 },
    );
  }

  const prepared = data as PreparedExport | null;

  const exportSessionId = prepared?.export_session_id;

  if (!prepared?.allowed || !exportSessionId) {
    const retryAfterSeconds = prepared?.retry_after_seconds ?? 60;
    return Response.json(
      { message: "Export limit reached. Try again after the displayed wait period.", retryAfterSeconds },
      {
        headers: { "Retry-After": String(retryAfterSeconds) },
        status: 429,
      },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const exportedAt = new Date().toISOString();
        const sectionCounts: Record<string, number> = {};
        let recordCount = 0;

        controller.enqueue(encoder.encode(`${JSON.stringify({
          type: "manifest",
          format: "tindio-organization-ndjson-v2",
          organizationId: context.organization.id,
          exportedAt,
        })}\n`));

        for (const section of exportSections) {
          let afterId: string | null = null;

          do {
            const { data: pageData, error: pageError } = await supabase.rpc(
              "get_organization_export_page",
              {
                target_export_session_id: exportSessionId,
                target_section: section,
                target_after_id: afterId ?? undefined,
              },
            );

            if (pageError) {
              throw new Error(pageError.message);
            }

            const page = pageData as ExportPage | null;
            const records = Array.isArray(page?.records) ? page.records : [];

            for (const record of records) {
              controller.enqueue(encoder.encode(`${JSON.stringify({ section, record })}\n`));
              recordCount += 1;
              sectionCounts[section] = (sectionCounts[section] ?? 0) + 1;
            }

            afterId = typeof page?.next_after_id === "string" ? page.next_after_id : null;
          } while (afterId);
        }

        const deliveryManifest: ExportManifest = {
          exportedAt,
          format: "tindio-organization-ndjson-v2",
          sections: sectionCounts,
        };
        const { error: deliveryError } = await supabase.rpc("complete_organization_export", {
          target_export_session_id: exportSessionId,
          target_record_count: recordCount,
          target_manifest: deliveryManifest,
        });

        if (deliveryError) {
          throw new Error(deliveryError.message);
        }

        controller.enqueue(encoder.encode(`${JSON.stringify({
          type: "completion",
          recordCount,
          ...deliveryManifest,
        })}\n`));

        controller.close();
      } catch (streamError) {
        controller.error(streamError);
      }
    },
  });

  const fileName = `tindio-${safeFileSegment(context.organization.name)}-export.ndjson`;

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
