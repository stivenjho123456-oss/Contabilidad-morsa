const ENV_API_URL = (import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");
const API_URL = ENV_API_URL || (
  typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && window.location.port === "5175"
    ? "http://127.0.0.1:8010"
    : ""
);

const DEFAULT_API_TIMEOUT_MS = 30000;
const AUTH_STORAGE_KEY = "morsa_auth_session";
const AUTH_INVALID_EVENT = "morsa-auth-invalid";
const PUBLIC_API_PATHS = new Set([
  "/api/auth/status",
  "/api/auth/login",
  "/api/auth/bootstrap",
]);

let apiSession = null;

function isPublicApiPath(path) {
  return PUBLIC_API_PATHS.has(path) || path === "/health";
}

function buildApiHeaders(headers, body) {
  const nextHeaders = new Headers(headers || {});
  if (body && !(body instanceof FormData) && !nextHeaders.has("Content-Type")) {
    nextHeaders.set("Content-Type", "application/json");
  }
  return nextHeaders;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export function resetApiSession() {
  apiSession = null;
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

function emitAuthInvalid() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_INVALID_EVENT));
  }
}

function normalizeApiSession(session) {
  if (!session?.token) return null;
  return {
    token: String(session.token),
    header: session.header || "Authorization",
    scheme: session.scheme || "Bearer",
    expires_at: session.expires_at || null,
    user: session.user || null,
  };
}

export function persistApiSession(session) {
  apiSession = normalizeApiSession(session);
  if (typeof window !== "undefined") {
    if (apiSession) {
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(apiSession));
    } else {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }
  return apiSession;
}

export function getStoredApiSession() {
  if (apiSession?.token) return apiSession;
  if (typeof window === "undefined") return null;
  try {
    apiSession = normalizeApiSession(JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) || "null"));
  } catch {
    apiSession = null;
  }
  if (!apiSession) return null;
  if (apiSession.expires_at) {
    const expiresAt = Date.parse(apiSession.expires_at);
    if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
      resetApiSession();
      return null;
    }
  }
  return apiSession;
}

async function parseApiError(res, fallbackMessage = "Error inesperado") {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await res.json().catch(() => ({ detail: fallbackMessage }));
    throw new Error(data.detail || fallbackMessage);
  }
  throw new Error(`Error HTTP ${res.status}`);
}

async function ensureApiSession() {
  const session = getStoredApiSession();
  if (session?.token) return session;
  throw new Error("Debes iniciar sesión para continuar.");
}

export async function fetchApi(path, options = {}, timeoutMs = DEFAULT_API_TIMEOUT_MS) {
  const headers = buildApiHeaders(options.headers, options.body);
  if (!isPublicApiPath(path)) {
    const session = await ensureApiSession();
    headers.set(session.header, `${session.scheme} ${session.token}`);
  }
  try {
    const res = await fetchWithTimeout(`${API_URL}${path}`, {
      ...options,
      headers,
    }, timeoutMs);
    if (res.status === 401 && !isPublicApiPath(path)) {
      resetApiSession();
      emitAuthInvalid();
    }
    return res;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("La solicitud tardó demasiado. Intenta de nuevo.");
    }
    throw new Error("No fue posible conectar con el servidor API.");
  }
}

export async function request(path, options) {
  const res = await fetchApi(path, options);
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    await parseApiError(res);
  }
  if (!contentType.includes("application/json")) {
    throw new Error("Respuesta inválida del servidor.");
  }
  const data = await res.json();
  if (data && typeof data === "object" && "ok" in data && "data" in data) {
    return data.data;
  }
  return data;
}

export async function downloadExcelFile(path, filename, setError, notify) {
  try {
    const res = await fetchApi(path, {}, 30000);
    if (!res.ok) {
      await parseApiError(res, "No se pudo generar el Excel");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    notify("Excel exportado correctamente", "success");
  } catch (err) {
    if (err?.name === "AbortError") {
      setError("La exportación tardó demasiado. Intenta de nuevo.");
      return;
    }
    setError(err.message);
  }
}

export async function uploadSupportFile(path, file, setError, notify) {
  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetchApi(path, {
      method: "POST",
      body: formData,
    }, 30000);
    const contentType = res.headers.get("content-type") || "";
    if (!res.ok) {
      await parseApiError(res, "No se pudo cargar el soporte");
    }
    notify("Soporte cargado correctamente", "success");
    return contentType.includes("application/json") ? (await res.json()).data : null;
  } catch (err) {
    setError(err.message);
    return null;
  }
}

export async function openProtectedFile(path, filename, setError) {
  try {
    const res = await fetchApi(path, {}, 30000);
    if (!res.ok) {
      await parseApiError(res, "No fue posible abrir el archivo.");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "archivo";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    setError(err.message);
  }
}

export function applyLoadTask(task, result, failures, { preserveOnError = false, applyToState = true } = {}) {
  if (result.status === "fulfilled") {
    if (applyToState) {
      task.apply(result.value);
    }
    return;
  }
  if (applyToState && !preserveOnError) {
    task.apply(task.fallback);
  }
  failures.push(`${task.label}: ${result.reason?.message || "error"}`);
}

export { AUTH_INVALID_EVENT };
