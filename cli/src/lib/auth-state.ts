import { isAccessTokenExpired, readCredentials, type Credentials } from "./credentials.js";

export type ActiveAuthKind = "oauth" | "none";

export interface AuthState {
  credentials: Credentials | null;
  hasOAuth: boolean;
  active: ActiveAuthKind;
}

export async function getAuthState(): Promise<AuthState> {
  const credentials = await readCredentials();

  const hasOAuth = Boolean(
    credentials?.accessToken &&
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
  };
}

export async function isAuthenticated(): Promise<boolean> {
  const state = await getAuthState();
  return state.active !== "none";
}
