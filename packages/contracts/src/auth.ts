export const TINDIO_AUTH_PROVIDERS = [
  "supabase",
  "neon",
] as const;

export type TindioAuthProvider =
  (typeof TINDIO_AUTH_PROVIDERS)[number];

export const TINDIO_DEFAULT_AUTH_PROVIDER =
  "supabase" as const satisfies TindioAuthProvider;

export type AuthIdentity = {
  subject: string;
  email: string | null;
  displayName: string | null;
};

export type AuthSession = {
  provider: TindioAuthProvider;
  accessToken: string;
  expiresAt: string | null;
  identity: AuthIdentity;
};

export type AuthCredentials = {
  email: string;
  password: string;
};

export type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "INVALID_SESSION"
  | "INVALID_TOKEN"
  | "PROVIDER_UNAVAILABLE"
  | "UNKNOWN";

export type AuthFailure = {
  code: AuthErrorCode;
  message: string;
  status: number | null;
};

export type AuthResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; error: AuthFailure };

export type AuthStateEvent =
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | "PASSWORD_RECOVERY"
  | "MFA_CHALLENGE_VERIFIED"
  | "UNKNOWN";

export type AuthSessionAdapter = {
  readonly provider: TindioAuthProvider;
  getSession(): Promise<AuthResult<AuthSession | null>>;
  refreshSession(): Promise<AuthResult<AuthSession | null>>;
  signInWithPassword(
    credentials: AuthCredentials,
  ): Promise<AuthResult<AuthSession>>;
  signOut(): Promise<AuthResult<null>>;
  onAuthStateChange(
    listener: (
      event: AuthStateEvent,
      session: AuthSession | null,
    ) => void,
  ): () => void;
};

export type AuthVerifiedClaims = {
  provider: TindioAuthProvider;
  subject: string;
  email: string | null;
  role: string | null;
  sessionId: string | null;
  expiresAt: string | null;
  raw: Readonly<Record<string, unknown>>;
};

export type AuthTokenVerifier = {
  readonly provider: TindioAuthProvider;
  verifyAccessToken(
    token: string,
  ): Promise<AuthResult<AuthVerifiedClaims>>;
};

export class AuthProviderSelectionError extends Error {
  readonly code = "AUTH_PROVIDER_NOT_ENABLED";

  constructor() {
    super("The configured Auth provider is not enabled for this runtime.");
    this.name = "AuthProviderSelectionError";
  }
}

export function resolveTindioAuthProvider(
  configuredProvider: string | null | undefined,
  enabledProviders: readonly TindioAuthProvider[] = [
    TINDIO_DEFAULT_AUTH_PROVIDER,
  ],
): TindioAuthProvider {
  const provider = configuredProvider?.trim()
    || TINDIO_DEFAULT_AUTH_PROVIDER;

  if (
    !TINDIO_AUTH_PROVIDERS.includes(
      provider as TindioAuthProvider,
    )
    || !enabledProviders.includes(
      provider as TindioAuthProvider,
    )
  ) {
    throw new AuthProviderSelectionError();
  }

  return provider as TindioAuthProvider;
}
