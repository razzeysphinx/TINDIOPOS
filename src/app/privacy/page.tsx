import type { Metadata } from "next";
import Link from "next/link";

import { PublicInformationPage } from "@/components/public/public-information-page";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How TINDIO POS handles account, business, transaction, device, and diagnostic data.",
};

export default function PrivacyPage() {
  return (
    <PublicInformationPage
      description="This policy explains the data handled by TINDIO POS and its connected Back Office service. It applies to the Android application identified by com.tindio.pos."
      eyebrow="Public policy"
      title="Privacy policy"
    >
      <section>
        <h2>Information TINDIO handles</h2>
        <ul>
          <li>Account and employee data, including name, email, phone, roles, store assignments, attendance, and authentication identifiers.</li>
          <li>Business data, including organizations, stores, registers, catalog, inventory, suppliers, and configuration.</li>
          <li>Customer and transaction data entered by authorized merchants, including receipts, sales, payments, refunds, shifts, and loyalty details.</li>
          <li>Device and reliability data, including device identity, application version, synchronization state, aggregate crash/ANR counts, latency, and recovery status.</li>
          <li>Camera access only when a user chooses barcode scanning. TINDIO does not use camera access for identity recognition or background recording.</li>
        </ul>
      </section>

      <section>
        <h2>Why the data is used</h2>
        <p>TINDIO uses this information to authenticate staff, enforce tenant/store permissions, operate checkout and inventory workflows, issue receipts, synchronize prepared terminals, recover accepted transactions, prevent fraud or duplication, support merchants, and maintain service security and reliability.</p>
      </section>

      <section>
        <h2>Storage and service providers</h2>
        <p>Information is processed by infrastructure providers used for authentication, application hosting, PostgreSQL database services, and authorized operational support. TINDIO does not sell personal data. A final Google Play Data safety declaration must match the exact release configuration and every included SDK.</p>
        <p>Android operational caches can include permitted catalog, customer, shift, receipt, device, and unresolved transaction records. Authentication and device secrets use protected device storage. Android application backup is disabled.</p>
      </section>

      <section>
        <h2>Security</h2>
        <p>TINDIO uses authenticated access, organization and store scoping, role-based permissions, encrypted HTTPS transport in production, protected device credentials, and server-side transaction validation. No system can guarantee absolute security.</p>
      </section>

      <section id="retention-and-deletion">
        <h2>Retention and deletion</h2>
        <p>Access credentials and personal profile information are removed or de-identified when deletion is approved and no legitimate retention requirement applies. TINDIO may retain limited records required for security, fraud prevention, dispute handling, audit, tax, accounting, or other legal obligations.</p>
        <p>Official sales, payment, receipt, inventory, shift, approval, and audit records are not silently erased when an employee account is closed. Where these records must be retained, access is revoked and personal data is minimized where technically and legally appropriate. Organization archival is not account deletion.</p>
        <p>See <Link href="/account-deletion">Delete your TINDIO account</Link> for the current request process and limitations.</p>
      </section>

      <section>
        <h2>Privacy contact</h2>
        <p>The responsible legal entity and public privacy contact have not yet been approved for publication. Until they are configured and verified, this release is blocked from Google Play production promotion.</p>
      </section>

      <section>
        <h2>Policy updates</h2>
        <p>Effective date: not yet approved. The published effective date must be recorded when the responsible entity accepts this policy for the release candidate.</p>
      </section>
    </PublicInformationPage>
  );
}
