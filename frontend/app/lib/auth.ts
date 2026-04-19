import { API_BASE_URL } from "./config";
import type { AuthTokenRecord } from "./types";

const accessTokenKey = "draftdeck-access-token";
const refreshTokenKey = "draftdeck-refresh-token";

function canUseStorage() {
  return typeof window !== "undefined";
}

export function getAccessToken() {
  if (!canUseStorage()) {
    return null;
  }
  return window.localStorage.getItem(accessTokenKey);
}

export function getRefreshToken() {
  if (!canUseStorage()) {
    return null;
  }
  return window.localStorage.getItem(refreshTokenKey);
}

export function setAuthTokens(tokens: AuthTokenRecord) {
  if (!canUseStorage()) {
    return;
  }
  window.localStorage.setItem(accessTokenKey, tokens.access_token);
  window.localStorage.setItem(refreshTokenKey, tokens.refresh_token);
}

export function clearAuthTokens() {
  if (!canUseStorage()) {
    return;
  }
  window.localStorage.removeItem(accessTokenKey);
  window.localStorage.removeItem(refreshTokenKey);
}

export function isAuthenticated() {
  return Boolean(getAccessToken() && getRefreshToken());
}

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }

  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    clearAuthTokens();
    return null;
  }

  const payload = (await response.json()) as AuthTokenRecord;
  setAuthTokens(payload);
  return payload.access_token;
}
