import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSION_KEY = "pikudo:st";
const DEVICE_KEY = "pikudo:deviceId";

export const DEFAULT_API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? "https://api.pikudogame.com"
).trim();

function createDeviceId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `dev_${ts}_${rand}`;
}

export function normalizeApiBaseUrl(baseUrl?: string | null): string {
  const raw = (baseUrl ?? "").trim();
  const fallback = DEFAULT_API_BASE_URL;
  return (raw || fallback).replace(/\/+$/, "");
}

export async function getDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_KEY);
    if (existing && existing.trim()) return existing;
  } catch {
    // ignore
  }
  const next = createDeviceId();
  try {
    await AsyncStorage.setItem(DEVICE_KEY, next);
  } catch {
    // ignore
  }
  return next;
}

export async function getSessionToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export async function setSessionToken(token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SESSION_KEY, token);
  } catch {
    // ignore
  }
}

export async function clearSessionToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export type ApiOk<T> = { ok: true } & T;
export type ApiErr = { ok: false; error: string };

function normalizeApiPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "/";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function getPathCandidates(path: string): string[] {
  const normalized = normalizeApiPath(path);
  if (/^https?:\/\//i.test(normalized)) {
    return [normalized];
  }
  return [normalized];
}

export function buildApiUrlCandidates(baseUrl: string, path: string): string[] {
  const normalizedBase = normalizeApiBaseUrl(baseUrl);
  return getPathCandidates(path).map((candidate) => {
    if (/^https?:\/\//i.test(candidate)) {
      return candidate;
    }
    return `${normalizedBase}${candidate}`;
  });
}

function readApiError(json: unknown): string {
  if (json && typeof json === "object") {
    const maybeError = (json as { error?: unknown; message?: unknown }).error;
    if (typeof maybeError === "string" && maybeError.trim()) {
      return maybeError;
    }

    const maybeMessage = (json as { error?: unknown; message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }
  }

  return "REQUEST_FAILED";
}

function fallbackErrorByStatus(status: number): string {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 413) return "FILE_TOO_LARGE";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "INTERNAL_ERROR";
  return "REQUEST_FAILED";
}

async function fetchWithPathFallback<T>(
  method: string,
  urls: string[],
  run: (url: string) => Promise<Response>
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];

    try {
      console.log("[PIKUDO APP API]", method, url);
      const response = await run(url);
      console.log("[PIKUDO APP API]", response.status, url);

      const json = await response.json().catch(() => null);
      if (response.ok) {
        return { ok: true, data: json as T };
      }

      if (response.status === 404 && index < urls.length - 1) {
        continue;
      }

      const parsedError = readApiError(json);
      const error = parsedError === "REQUEST_FAILED" ? fallbackErrorByStatus(response.status) : parsedError;

      return {
        ok: false,
        status: response.status,
        error
      };
    } catch {
      if (index < urls.length - 1) {
        continue;
      }
      return { ok: false, status: 0, error: "NETWORK_ERROR" };
    }
  }

  return { ok: false, status: 0, error: "NETWORK_ERROR" };
}

export async function apiFetchJson<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit & { auth?: boolean }
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const method = (init?.method ?? "GET").toUpperCase();
  const urls = buildApiUrlCandidates(baseUrl, path);

  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  const deviceId = await getDeviceId();
  headers["x-device-id"] = deviceId;

  if (init?.auth !== false) {
    const st = await getSessionToken();
    if (st) headers["x-session-token"] = st;
  }

  return fetchWithPathFallback<T>(method, urls, (url) => fetch(url, { ...init, headers }));
}

export async function apiFetchForm<T>(
  baseUrl: string,
  path: string,
  form: FormData,
  init?: Omit<RequestInit, "body" | "headers"> & { auth?: boolean }
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const method = (init?.method ?? "POST").toUpperCase();
  const urls = buildApiUrlCandidates(baseUrl, path);

  const headers: Record<string, string> = {};
  const deviceId = await getDeviceId();
  headers["x-device-id"] = deviceId;

  if (init?.auth !== false) {
    const st = await getSessionToken();
    if (st) headers["x-session-token"] = st;
  }

  return fetchWithPathFallback<T>(method, urls, (url) =>
    fetch(url, { ...init, method: init?.method ?? "POST", headers, body: form } as RequestInit)
  );
}
