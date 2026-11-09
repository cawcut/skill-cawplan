import { getBaseUrl } from "./config.js";
import { credentialApiBase, isAccessTokenExpired, readCredentials, type Credentials } from "./credentials.js";

export type ActiveAuthKind = "oauth" | "none";

export interface AuthState {
  credentials: Credentials | null;
  hasOAuth: boolean;
  active: ActiveAuthKind;
  /** Set when the stored credentials belong to another environment than the active one. */
  envMismatch?: { issuedFor: string; active: string };
}

export async function getAuthState(): Promise<AuthState> {
  const credentials = await readCredentials();
  const envMismatch = credentials?.accessToken ? findEnvMismatch(credentials) : undefined;

  const hasOAuth = Boolean(
    credentials?.accessToken &&
      !envMismatch &&
      (!isAccessTokenExpired(credentials) || credentials.refreshToken),
  );

  let active: ActiveAuthKind = "none";
  if (hasOAuth) {
    active = "oauth";
  }

  return {
    credentials,
    hasOAuth,
    active,
    ...(envMismatch ? { envMismatch } : {}),
  };
}

function findEnvMismatch(credentials: Credentials): AuthState["envMismatch"] {
  let active: string;
  try {
    active = getBaseUrl();
  } catch {
    // An insecure apiBase is reported by the request itself.
    return undefined;
  }
  const issuedFor = credentialApiBase(credentials);
  return issuedFor === active ? undefined : { issuedFor, active };
}

export async function isAuthenticated(): Promise<boolean> {
  const state = await getAuthState();
  return state.active !== "none";
}
