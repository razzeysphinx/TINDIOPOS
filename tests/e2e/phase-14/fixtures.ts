import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import {
  createClient,
} from "@supabase/supabase-js";

const apiUrl =
  process.env
    .TINDIO_E2E_SUPABASE_URL;

const serviceRoleKey =
  process.env
    .TINDIO_E2E_SERVICE_ROLE_KEY;

if (
  !apiUrl
  || !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/i
    .test(apiUrl)
) {
  throw new Error(
    "Phase 14 fixture refuses a non-local Supabase URL.",
  );
}

if (
  !serviceRoleKey
) {
  throw new Error(
    "Phase 14 fixture requires the local service-role key.",
  );
}

const admin =
  createClient(
    apiUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

export async function createScopedEmployee(input: {
  email: string;
  ownerEmail: string;
  organizationName: string;
  permissionCodes: string[];
  storeName: string;
}) {
  const user = await createConfirmedLocalUser(
    input.email,
    `Phase 14 scoped employee ${input.storeName}`,
  );
  const owner = createClient(apiUrl!, serviceRoleKey!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const { error: ownerLoginError } = await owner.auth.signInWithPassword({
    email: input.ownerEmail,
    password: phase14Password,
  });
  if (ownerLoginError) throw new Error(`Unable to authenticate Phase 14 owner fixture: ${ownerLoginError.message}`);

  const { data: organization, error: organizationError } = await owner
    .from("organizations")
    .select("id")
    .eq("name", input.organizationName)
    .single();
  if (organizationError || !organization) throw new Error(`Unable to resolve Phase 14 organization: ${organizationError?.message ?? "missing"}`);

  const { data: store, error: storeError } = await owner
    .from("stores")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("name", input.storeName)
    .single();
  if (storeError || !store) throw new Error(`Unable to resolve Phase 14 store: ${storeError?.message ?? "missing"}`);

  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const { data: role, error: roleError } = await owner
    .from("roles")
    .insert({
      organization_id: organization.id,
      name: `Phase 14 Scoped ${suffix}`,
      code: `p14_scoped_${suffix}`,
      description: "Local Phase 14 assigned-store browser fixture",
    })
    .select("id")
    .single();
  if (roleError || !role) throw new Error(`Unable to create Phase 14 role: ${roleError?.message ?? "missing"}`);

  const { data: employee, error: employeeError } = await owner
    .from("employees")
    .insert({
      organization_id: organization.id,
      profile_id: user.id,
      employee_number: `P14-${suffix.toUpperCase()}`,
      job_title: "Scoped inventory operator",
    })
    .select("id")
    .single();
  if (employeeError || !employee) throw new Error(`Unable to create Phase 14 employee: ${employeeError?.message ?? "missing"}`);

  const { error: permissionError } = await owner.from("role_permissions").insert(
    input.permissionCodes.map((permissionCode) => ({
      organization_id: organization.id,
      role_id: role.id,
      permission_code: permissionCode,
    })),
  );
  if (permissionError) throw new Error(`Unable to grant Phase 14 permissions: ${permissionError.message}`);

  const { error: employeeRoleError } = await owner.from("employee_roles").insert({
    organization_id: organization.id,
    employee_id: employee.id,
    role_id: role.id,
  });
  if (employeeRoleError) throw new Error(`Unable to assign Phase 14 role: ${employeeRoleError.message}`);

  const { error: employeeStoreError } = await owner.from("employee_stores").insert({
    organization_id: organization.id,
    employee_id: employee.id,
    store_id: store.id,
  });
  if (employeeStoreError) throw new Error(`Unable to assign Phase 14 store: ${employeeStoreError.message}`);

  return { employeeId: employee.id, organizationId: organization.id, storeId: store.id };
}

export const phase14Password =
  "TindioPhase14!Local2026";

export function uniqueEmail(
  label: string,
) {
  const run =
    process.env
      .TINDIO_E2E_RUN_ID
    ?? Date.now()
      .toString();

  return (
    `phase14-${label}-${run}`
    + "@tindio.local"
  );
}

export async function createConfirmedLocalUser(
  email: string,
  fullName: string,
) {
  const {
    data,
    error,
  } =
    await admin
      .auth
      .admin
      .createUser({
        email,
        password:
          phase14Password,
        email_confirm: true,
        user_metadata: {
          full_name:
            fullName,
        },
      });

  if (
    error
    || !data.user
  ) {
    throw new Error(
      `Unable to create local Phase 14 user: ${error?.message ?? "unknown error"}`,
    );
  }

  return data.user;
}

export async function loginThroughUi(
  page: Page,
  email: string,
  next = "/workspace",
) {
  await page.goto(
    `/login?next=${encodeURIComponent(next)}`,
  );

  await page
    .getByLabel("Email")
    .fill(email);

  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(
      phase14Password,
    );

  await page
    .getByRole(
      "button",
      {
        name: "Sign in",
      },
    )
    .click();

  await expect(
    page,
  ).not.toHaveURL(
    /\/login(?:\?|$)/,
  );
}

export async function createOwnerBusiness(
  page: Page,
  input: {
    email: string;
    businessName: string;
    storeName: string;
    registerName: string;
  },
) {
  await createConfirmedLocalUser(
    input.email,
    `${input.businessName} Owner`,
  );

  await loginThroughUi(
    page,
    input.email,
    "/onboarding",
  );

  await expect(
    page,
  ).toHaveURL(
    /\/onboarding/,
  );

  await page
    .getByLabel(
      "Business name",
    )
    .fill(
      input.businessName,
    );

  await page
    .getByLabel(
      "First store",
    )
    .fill(
      input.storeName,
    );

  await page
    .getByLabel(
      "First register",
    )
    .fill(
      input.registerName,
    );

  await page
    .getByRole(
      "button",
      {
        name:
          "Create business",
      },
    )
    .click();

  await expect(
    page,
  ).toHaveURL(
    /\/back-office/,
    {
      timeout: 30_000,
    },
  );
}

export async function newContext(
  browser: Browser,
) {
  return browser.newContext({
    viewport: {
      width: 1440,
      height: 1000,
    },
  });
}

export async function closeContext(
  context:
    BrowserContext,
) {
  await context.close();
}
