import { getApiKey } from "./config.js";
import { isAccessTokenExpired, readCredentials, type Credentials } from "./credentials.js";

export type ActiveAuthKind = "oauth" | "apiKey" | "none";

export interface AuthState {
  credentials: Credentials | null;
  envApiKey?: string;
  hasOAuth: boolean;
  hasApiKey: boolean;
  active: ActiveAuthKind;
}

export async function getAuthState(): Promise<AuthState> {
  const credentials = await readCredentials();
  const envApiKey = getApiKey();

  const hasOAuth = Boolean(
    credentials?.accessToken &&
      (!isAccessTokenExpired(credentials) || credentials.refreshToken),
  );
  const hasApiKey = Boolean(credentials?.apiKey || envApiKey);

  let active: ActiveAuthKind = "none";
  if (hasOAuth) {
    active = "oauth";
  } else if (hasApiKey) {
    active = "apiKey";
  }

  return {
    credentials,
    envApiKey,
    hasOAuth,
    hasApiKey,
    active,
  };
}

export async function isAuthenticated(): Promise<boolean> {
  const state = await getAuthState();
  return state.active !== "none";
}
