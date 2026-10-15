import type { Metadata } from "next";
import Link from "next/link";

import { PublicInformationPage } from "@/components/public/public-information-page";

export const metadata: Metadata = {
  title: "Support",
  description: "Support and safe recovery guidance for TINDIO POS.",
};

export default function SupportPage() {
  return (
    <PublicInformationPage
      description="Use these safe recovery steps for TINDIO POS. Never uninstall the app, clear its storage, or delete pending transactions to solve a synchronization problem."
      eyebrow="Help and recovery"
      title="TINDIO support"
    >
      <section>
        <h2>Cashier help</h2>
        <ul>
          <li>Keep the device powered on and preserve the current signed-in context.</li>
          <li>Open Sync status and record the readiness message, pending count, and visible recovery reason.</li>
          <li>Reconnect normally and use the built-in retry or recovery control. Do not create a replacement sale for an already accepted cash transaction.</li>
          <li>Ask the organization owner or authorized manager to review device, employee, store, shift, and synchronization access.</li>
        </ul>
      </section>

      <section>
        <h2>Information to include</h2>
        <p>Provide the organization and store name, device name, approximate time, app version, and the non-sensitive error message. Do not send passwords, access tokens, device secrets, card credentials, or full customer/receipt payloads.</p>
      </section>

      <section>
        <h2>Public support contact</h2>
        <p>A named support owner and public contact channel have not yet been approved for publication. The Phase 24 production gate remains blocked until a monitored contact is configured and tested.</p>
      </section>

      <section>
        <h2>Privacy and account requests</h2>
        <p>Read the <Link href="/privacy">privacy policy</Link> or review the <Link href="/account-deletion">account-deletion process</Link>. Operational support must not erase official financial history or unresolved local transaction custody.</p>
      </section>
    </PublicInformationPage>
  );
}
