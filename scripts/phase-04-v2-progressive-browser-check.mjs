import assert from "node:assert/strict";
import process from "node:process";

import {
  chromium,
  expect,
} from "@playwright/test";

function required(name) {
  const value =
    process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `${name} is required.`,
    );
  }

  return value;
}

const deployment =
  new URL(
    required(
      "TINDIO_PHASE_04_DEPLOYMENT_URL",
    ),
  );
const email =
  required(
    "TINDIO_PHASE_04_TEST_EMAIL",
  );
const password =
  required(
    "TINDIO_PHASE_04_TEST_PASSWORD",
  );
const bypass =
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    ?.trim()
  || null;

function endpoint(pathname) {
  return new URL(
    pathname,
    deployment,
  ).toString();
}

async function signedInPage(browser) {
  const context =
    await browser.newContext({
      extraHTTPHeaders: bypass
        ? {
            "x-vercel-protection-bypass":
              bypass,
            "x-vercel-set-bypass-cookie":
              "true",
          }
        : {},
    });
  const page =
    await context.newPage();
  const response =
    await page.goto(
      endpoint("/login"),
      {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      },
    );

  assert.ok(
    response?.ok(),
    `Preview login returned HTTP ${response?.status() ?? "no response"}.`,
  );

  await page
    .getByLabel("Email")
    .fill(email);
  await page
    .getByLabel("Password", {
      exact: true,
    })
    .fill(password);
  await page
    .getByRole("button", {
      name: "Sign in",
    })
    .click();
  await page.waitForURL(
    (url) =>
      !url.pathname.startsWith("/login"),
    {
      timeout: 30_000,
    },
  );

  const signedInUrl =
    new URL(page.url());

  assert.ok(
    !signedInUrl.pathname.startsWith("/onboarding"),
    "Certification account was redirected to onboarding.",
  );
  assert.ok(
    !signedInUrl.pathname.startsWith("/workspace/no-access"),
    "Certification account has no workspace access.",
  );

  return {
    context,
    page,
  };
}

async function expectCoreAvailable(page) {
  const bootstrap =
    await page.waitForResponse(
      (response) =>
        response.url().includes(
          "/api/pos/v2/bootstrap",
        ),
      {
        timeout: 30_000,
      },
    );

  assert.equal(
    bootstrap.status(),
    200,
    `V2 core bootstrap returned HTTP ${bootstrap.status()}.`,
  );
  await page.waitForTimeout(1_500);
  await expect(
    page.getByText(
      "POS startup is temporarily unavailable",
      { exact: true },
    ),
  ).toHaveCount(0);
}

async function expectWarning(page, text) {
  await expect(
    page.getByText(text, {
      exact: true,
    }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText(
      "POS startup is temporarily unavailable",
      { exact: true },
    ),
  ).toHaveCount(0);
}

async function expectStartupFailure(page) {
  await expect(
    page.getByText(
      "POS startup is temporarily unavailable",
      { exact: true },
    ),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("button", {
      name: "Retry",
    }),
  ).toBeVisible();
}

const browser =
  await chromium.launch();

try {
  {
    const {
      context,
      page,
    } =
      await signedInPage(browser);

    try {
      const ready =
        expectCoreAvailable(page);
      await page.goto(
        endpoint("/pos"),
        {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        },
      );
      await ready;
      console.log("V2 progressive browser baseline: PASS");
    } finally {
      await context.close();
    }
  }

  {
    const {
      context,
      page,
    } =
      await signedInPage(browser);

    try {
      await page.route(
        "**/api/pos/v2/reference**",
        async (route) => {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            headers: {
              "x-tindio-request-id":
                "phase-04-v2-reference-failure",
            },
            body: JSON.stringify({
              error: "certification reference failure",
            }),
          });
        },
      );
      const ready =
        expectCoreAvailable(page);
      await page.goto(
        endpoint("/pos"),
        {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        },
      );
      await ready;
      await expectWarning(
        page,
        "POS configuration is temporarily unavailable.",
      );
      console.log("V2 progressive Reference fallback: PASS");
    } finally {
      await context.close();
    }
  }

  {
    const {
      context,
      page,
    } =
      await signedInPage(browser);

    try {
      await page.route(
        "**/api/pos/v2/live**",
        async (route) => {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            headers: {
              "x-tindio-request-id":
                "phase-04-v2-live-failure",
            },
            body: JSON.stringify({
              error: "certification live failure",
            }),
          });
        },
      );
      const ready =
        expectCoreAvailable(page);
      await page.goto(
        endpoint("/pos"),
        {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        },
      );
      await ready;
      await expectWarning(
        page,
        "Live POS tools are temporarily unavailable.",
      );
      console.log("V2 progressive Live fallback: PASS");
    } finally {
      await context.close();
    }
  }

  {
    const {
      context,
      page,
    } =
      await signedInPage(browser);

    try {
      await page.route(
        "**/api/pos/v2/bootstrap**",
        async (route) => {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            headers: {
              "x-tindio-request-id":
                "phase-04-v2-core-failure",
            },
            body: JSON.stringify({
              error: "certification core failure",
            }),
          });
        },
      );
      await page.goto(
        endpoint("/pos"),
        {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        },
      );
      await expectStartupFailure(page);
      console.log("V2 progressive Core blocking failure: PASS");
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log("PHASE 04 V2 PROGRESSIVE BROWSER: PASS");
