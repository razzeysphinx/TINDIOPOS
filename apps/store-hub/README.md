# TINDIO Store Hub transport

> **Current release scope:** Store Hub is deferred from the first production
> release and is not a certified merchant feature. The implementation is
> retained for later completion of MOB-11, A39, and A40. Do not deploy or
> advertise it until the release-scope guard is deliberately reopened and the
> required physical/trusted-network evidence passes.

The production Store Hub serves HTTPS directly. Plain HTTP is disabled by default and cannot be enabled when `NODE_ENV=production`.

## Production configuration

Set all of the following before starting the service:

```text
NODE_ENV=production
TINDIO_STORE_HUB_ORGANIZATION_ID=<organization UUID>
TINDIO_STORE_HUB_STORE_ID=<store UUID>
TINDIO_STORE_HUB_TOKEN=<random store-scoped secret of at least 32 characters>
TINDIO_STORE_HUB_TLS_CERT_PATH=<absolute path to the full certificate chain PEM>
TINDIO_STORE_HUB_TLS_KEY_PATH=<absolute path to the matching private-key PEM>
TINDIO_STORE_HUB_DATA_DIR=<durable local journal directory>
```

The certificate must:

- be valid for the exact hostname or IP address entered on every terminal;
- chain to a certificate authority trusted by the managed Android devices;
- remain valid without WAN access during store-local operation;
- use a private key readable only by the Store Hub service account.

Provision local DNS and certificates before enabling the Hub for a merchant. Certificate renewal, service startup supervision, token distribution/rotation, and journal backup/retention belong to the merchant deployment runbook. Never place the private key or store token in the repository.

Android production builds keep global cleartext traffic disabled. A release runtime rejects `http://` Hub endpoints even if an old SecureStore configuration survives an in-place upgrade. That rejection does not delete the stored configuration or any transaction-custody data.

## Development-only HTTP

Local development may opt into HTTP explicitly:

```text
TINDIO_STORE_HUB_ALLOW_INSECURE_HTTP=1
```

The override is rejected when `NODE_ENV=production`. It is not an approved merchant deployment mode and cannot make an Android release build accept an HTTP endpoint.
