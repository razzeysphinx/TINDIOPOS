import type { Metadata } from "next";
import Link from "next/link";

import { PublicInformationPage } from "@/components/public/public-information-page";

export const metadata: Metadata = {
  title: "Delete account",
  description: "How to request deletion of a TINDIO account and understand retained business records.",
};

export default function AccountDeletionPage() {
  return (
    <PublicInformationPage
      description="TINDIO offers account creation through its web service, so account deletion requests apply to the Android POS service even though the Android app itself is sign-in-only."
      eyebrow="Account and data controls"
      title="Delete your TINDIO account"
    >
      <section>
        <h2>Current request path</h2>
        <ol className="mt-3 space-y-1.5 [&_li]:ml-5 [&_li]:list-decimal">
          <li>Ask your organization owner or authorized administrator to deactivate your employee access immediately.</li>
          <li>The administrator reviews open shifts, attendance, unresolved terminal custody, and historical dependencies before removing eligible employee data.</li>
          <li>For deletion of the underlying login identity or a business-owner account, use the public privacy contact once it is published on this page.</li>
        </ol>
        <p className="mt-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4"><strong>Request intake is not yet production-ready.</strong> The responsible legal entity and monitored privacy contact have not been configured. Google Play production promotion is blocked until the complete request channel is functional and verified.</p>
      </section>

      <section>
        <h2>What deletion means</h2>
        <p>Temporary deactivation, suspension, or organization archival is not treated as completed account deletion. When a valid request is approved, TINDIO must remove the login identity and associated personal data unless a legitimate security, fraud-prevention, contractual, tax, accounting, audit, or legal-retention reason requires limited data to remain.</p>
      </section>

      <section>
        <h2>Records that may be retained</h2>
        <p>Official sales, payments, receipts, inventory movements, shifts, refunds, approvals, and audit records may need to remain accurate and immutable. Retained records are restricted to authorized business and support roles; deletion does not permit silent transaction loss or the removal of unresolved device custody.</p>
        <p>Read the full <Link href="/privacy#retention-and-deletion">retention and deletion explanation</Link>.</p>
      </section>

      <section>
        <h2>Before production certification</h2>
        <p>TINDIO must publish and test a monitored request channel, name the responsible entity, record expected response handling, verify the public HTTPS URL without authentication or geofencing, and enter the same URL in Play Console.</p>
      </section>
    </PublicInformationPage>
  );
}
