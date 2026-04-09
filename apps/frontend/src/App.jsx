import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const ENV_API_URL = (import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");
const API_URL = ENV_API_URL || (
  typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && window.location.port === "5175"
    ? "http://127.0.0.1:8010"
    : ""
);

const MONTH_NAMES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

const NAV_ITEMS = [
  { key: "dashboard",   label: "Dashboard" },
  { key: "caja",        label: "Caja" },
  { key: "egresos",     label: "Egresos" },
  { key: "ingresos",    label: "Ingresos" },
  { key: "nomina",      label: "Nomina" },
  { key: "proveedores", label: "Proveedores y Base" },
  { key: "reportes",    label: "Reportes" },
];

const TIPO_COLORS = [
  "#e74c3c","#e67e22","#f39c12","#2ecc71","#3498db",
  "#9b59b6","#1abc9c","#e91e63","#ff5722","#607d8b",
];

const EMPTY_SYSTEM_SUMMARY = {
  counts: {},
  db_health: { ok: true, integrity: "ok", exists: true, size_bytes: 0, backend: "postgresql" },
  deployment_mode: "cloud",
  storage_mode: "database",
  log_file: "",
};
const EMPTY_NOMINA = {
  periodos: [],
  stats: {},
  workflow: { steps: [] },
  resumen: [],
  asistencia: [],
  asistencia_resumen: [],
  seg_social: [],
  novedades: [],
};
const DEFAULT_API_TIMEOUT_MS = 30000;
const AUTH_STORAGE_KEY = "morsa_auth_session";
const AUTH_INVALID_EVENT = "morsa-auth-invalid";
const PUBLIC_API_PATHS = new Set([
  "/api/auth/status",
  "/api/auth/login",
  "/api/auth/bootstrap",
]);
let apiSession = null;

function buildViewCacheKey(view, { month, year, periodoNomina }) {
  switch (view) {
    case "dashboard":
      return `dashboard:${year}-${String(month).padStart(2, "0")}`;
    case "ingresos":
      return `ingresos:${year}-${String(month).padStart(2, "0")}`;
    case "egresos":
      return `egresos:${year}-${String(month).padStart(2, "0")}`;
    case "reportes":
      return `reportes:${year}-${String(month).padStart(2, "0")}`;
    case "nomina":
      return `nomina:${periodoNomina || "__default__"}`;
    case "proveedores":
      return "proveedores";
    case "caja":
      return "caja";
    default:
      return view;
  }
}

function money(value) {
  return `$ ${Number(value || 0).toLocaleString("es-CO", { maximumFractionDigits: 0 })}`;
}

function applyLoadTask(task, result, failures, { preserveOnError = false, applyToState = true } = {}) {
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

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function resetApiSession() {
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

function persistApiSession(session) {
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

function getStoredApiSession() {
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

async function fetchApi(path, options = {}, timeoutMs = DEFAULT_API_TIMEOUT_MS) {
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

async function request(path, options) {
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

async function downloadExcelFile(path, filename, setError, notify) {
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

async function uploadSupportFile(path, file, setError, notify) {
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

async function openProtectedFile(path, filename, setError) {
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

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-x" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function AuthView({ requiresSetup, pending, error, onLogin, onBootstrap }) {
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [setupForm, setSetupForm] = useState({
    full_name: "",
    username: "",
    password: "",
    password_confirm: "",
  });

  async function handleLoginSubmit(event) {
    event.preventDefault();
    await onLogin(loginForm);
  }

  async function handleBootstrapSubmit(event) {
    event.preventDefault();
    await onBootstrap(setupForm);
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <section className="auth-side">
          <span className="auth-badge">Acceso Seguro</span>
          <h1>Contabilidad Morsa</h1>
          <p>
            Controla ingresos, egresos, caja, nómina y respaldos desde una sesión
            autenticada con perfil administrativo.
          </p>
          <div className="auth-side-list">
            <div>Sesión protegida y persistente</div>
            <div>Primer acceso con creación controlada del administrador</div>
            <div>Preparado para entorno local y despliegue web</div>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-panel-head">
            <h2>{requiresSetup ? "Configurar Administrador" : "Iniciar Sesión"}</h2>
            <p>
              {requiresSetup
                ? "Primer acceso detectado. Crea la cuenta administradora principal."
                : "Ingresa con tu usuario y contraseña para acceder al sistema."}
            </p>
          </div>

          {error && <div className="auth-error">{error}</div>}

          {requiresSetup ? (
            <form className="auth-form" onSubmit={handleBootstrapSubmit}>
              <label className="auth-field">
                <span>Nombre completo</span>
                <input
                  value={setupForm.full_name}
                  onChange={(event) => setSetupForm((current) => ({ ...current, full_name: event.target.value }))}
                  placeholder="Administrador General"
                  autoComplete="name"
                  required
                />
              </label>
              <label className="auth-field">
                <span>Usuario</span>
                <input
                  value={setupForm.username}
                  onChange={(event) => setSetupForm((current) => ({ ...current, username: event.target.value }))}
                  placeholder="admin"
                  autoComplete="username"
                  required
                />
              </label>
              <label className="auth-field">
                <span>Contraseña</span>
                <input
                  type="password"
                  value={setupForm.password}
                  onChange={(event) => setSetupForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder="Mínimo 10 caracteres"
                  autoComplete="new-password"
                  required
                />
              </label>
              <label className="auth-field">
                <span>Confirmar contraseña</span>
                <input
                  type="password"
                  value={setupForm.password_confirm}
                  onChange={(event) => setSetupForm((current) => ({ ...current, password_confirm: event.target.value }))}
                  placeholder="Repite la contraseña"
                  autoComplete="new-password"
                  required
                />
              </label>
              <div className="auth-note">
                La contraseña debe incluir mínimo 10 caracteres, mayúscula, minúscula y número.
              </div>
              <button className="auth-submit" type="submit" disabled={pending}>
                {pending ? "Creando cuenta..." : "Crear administrador"}
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={handleLoginSubmit}>
              <label className="auth-field">
                <span>Usuario</span>
                <input
                  value={loginForm.username}
                  onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
                  placeholder="Tu usuario"
                  autoComplete="username"
                  required
                />
              </label>
              <label className="auth-field">
                <span>Contraseña</span>
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder="Tu contraseña"
                  autoComplete="current-password"
                  required
                />
              </label>
              <button className="auth-submit" type="submit" disabled={pending}>
                {pending ? "Validando..." : "Entrar"}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

function Toast({ notice, onClose }) {
  if (!notice) return null;
  return (
    <div className={`toast toast-${notice.tone || "info"}`}>
      <span>{notice.message}</span>
      <button type="button" onClick={onClose}>✕</button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      {children}
    </div>
  );
}

function DataTable({ columns, rows, selectedId, onSelect, maxHeight = "420px" }) {
  return (
    <div className="table-shell" style={{ maxHeight }}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => <th key={col.key}>{col.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, idx) => {
            const rowKey = row.id ?? row.name ?? row.path ?? idx;
            return (
              <tr
                key={rowKey}
                className={rowKey === selectedId ? "row-selected" : ""}
                onClick={() => onSelect?.(row)}
              >
                {columns.map((col) => (
                  <td key={col.key}>
                    {col.render ? col.render(row[col.key], row) : (row[col.key] ?? "")}
                  </td>
                ))}
              </tr>
            );
          }) : (
            <tr>
              <td colSpan={columns.length} className="empty-cell">Sin registros</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ label, value, tone }) {
  return (
    <div className={`stat-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricStrip({ items }) {
  return (
    <div className="metric-strip">
      {items.map((item) => (
        <div key={item.label} className="metric-pill">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function initials(value = "") {
  return value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "NA";
}

function formatDateLabel(value) {
  if (!value) return "Sin fecha";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "2-digit" });
}

/** White toolbar card: title on the left, controls on the right */
function Toolbar({ title, subtitle, children }) {
  return (
    <div className="toolbar-bar">
      <div className="toolbar-left">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="toolbar-right">{children}</div>
    </div>
  );
}

/** Colored action button matching app palette */
function TBtn({ tone = "navy", ...props }) {
  return <button className={`tbtn tbtn-${tone}`} {...props} />;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function DashboardView({ year, month, setYear, setMonth, years, navigate, dashboard }) {
  const stats = dashboard?.stats;

  return (
    <div className="page-view">
      <Toolbar title="Dashboard">
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </Toolbar>

      <div className="quick-banner">
        <div className="quick-text">
          <strong>Accesos rápidos</strong>
          <p>Si quieres crear un proveedor nuevo, entra por "Proveedores y Base" o usa el botón directo de abajo.</p>
        </div>
        <div className="quick-btns">
          <TBtn tone="green"  onClick={() => navigate("proveedores")}>Nuevo Proveedor</TBtn>
          <TBtn tone="navy"   onClick={() => navigate("egresos")}>Registrar Egreso</TBtn>
          <TBtn tone="blue"   onClick={() => navigate("ingresos")}>Registrar Ingreso</TBtn>
          <TBtn tone="purple" onClick={() => navigate("reportes")}>Ver Cierre Mensual</TBtn>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="💰  Total Ingresos" value={money(stats?.total_ingresos)} tone="green" />
        <StatCard label="💸  Total Egresos"  value={money(stats?.total_egresos)}  tone="red" />
        <StatCard
          label="📈  Utilidad Bruta"
          value={money(stats?.utilidad)}
          tone={(stats?.utilidad ?? 0) >= 0 ? "blue" : "red"}
        />
      </div>

      <div className="split-panels">
        <div className="panel">
          <h3 className="panel-title">Egresos por Naturaleza</h3>
          <div className="tipo-list">
            {(stats?.egresos_by_tipo || []).map(([tipo, total], i) => {
              const pct = stats.total_egresos
                ? ((total / stats.total_egresos) * 100).toFixed(1)
                : "0.0";
              return (
                <div key={tipo} className="tipo-row">
                  <span className="tipo-dot" style={{ color: TIPO_COLORS[i % TIPO_COLORS.length] }}>●</span>
                  <span className="tipo-name">{tipo || "—"}</span>
                  <span className="tipo-val">{money(total)}  ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <h3 className="panel-title">Últimos Egresos</h3>
          <div className="recent-list">
            {(stats?.recent_egresos || []).map((eg, i) => (
              <div key={i} className="recent-row">
                <span className="recent-date">{eg.fecha}</span>
                <span className="recent-name">{(eg.razon_social || "").slice(0, 28)}</span>
                <span className="recent-val">{money(eg.valor)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Proveedores ───────────────────────────────────────────────────────────────

const EMPTY_PROV = {
  razon_social: "", nit: "", primer_nombre: "", segundo_nombre: "",
  primer_apellido: "", segundo_apellido: "", direccion: "", telefono: "", correo: "",
};

function ProveedorModal({ data, onClose, onSaved, setError, notify }) {
  const [form, setForm] = useState({ ...EMPTY_PROV, ...(data || {}) });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    try {
      setSaving(true);
      if (data?.id)
        await request(`/api/proveedores/${data.id}`, { method: "PUT", body: JSON.stringify(form) });
      else
        await request("/api/proveedores", { method: "POST", body: JSON.stringify(form) });
      onSaved();
      notify(data?.id ? "Proveedor actualizado" : "Proveedor creado", "success");
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={data?.id ? "Editar Proveedor" : "Nuevo Proveedor"} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <Field label="Razón Social *"><input required value={form.razon_social} onChange={set("razon_social")} /></Field>
        <Field label="NIT"><input value={form.nit} onChange={set("nit")} /></Field>
        <Field label="Primer Nombre"><input value={form.primer_nombre} onChange={set("primer_nombre")} /></Field>
        <Field label="Segundo Nombre"><input value={form.segundo_nombre} onChange={set("segundo_nombre")} /></Field>
        <Field label="Primer Apellido"><input value={form.primer_apellido} onChange={set("primer_apellido")} /></Field>
        <Field label="Segundo Apellido"><input value={form.segundo_apellido} onChange={set("segundo_apellido")} /></Field>
        <Field label="Dirección"><input value={form.direccion} onChange={set("direccion")} /></Field>
        <Field label="Teléfono"><input value={form.telefono} onChange={set("telefono")} /></Field>
        <Field label="Correo"><input type="email" value={form.correo} onChange={set("correo")} /></Field>
        <div className="modal-footer">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn-save" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ProveedoresView({ proveedores, reload, setError, notify }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null); // null | "new" | "edit"
  const deferredSearch = useDeferredValue(search);

  const filtered = proveedores.filter((p) =>
    `${p.razon_social} ${p.nit}`.toLowerCase().includes(deferredSearch.toLowerCase())
  );

  async function handleDelete() {
    if (!selected) { alert("Selecciona un proveedor para eliminar."); return; }
    if (!window.confirm("¿Eliminar este proveedor?")) return;
    try {
      await request(`/api/proveedores/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      reload();
      notify("Proveedor eliminado", "success");
    } catch (err) { setError(err.message); }
  }

  async function handleExport() {
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    await downloadExcelFile(`/api/export/proveedores${query}`, "Proveedores.xlsx", setError, notify);
  }

  return (
    <div className="page-view">
      <Toolbar
        title="Proveedores / Base de Datos"
        subtitle="Aquí puedes crear, editar y buscar proveedores. Usa el botón '+ Nuevo' para registrar uno."
      >
        <input className="search-input" placeholder="Buscar..." value={search}
          onChange={(e) => setSearch(e.target.value)} />
        <TBtn tone="green" onClick={handleExport}>Exportar Excel</TBtn>
        <TBtn tone="navy" onClick={() => setModal("new")}>+ Nuevo</TBtn>
        <TBtn tone="blue" onClick={() => {
          if (!selected) { alert("Selecciona un proveedor para editar."); return; }
          setModal("edit");
        }}>Editar</TBtn>
        <TBtn tone="red" onClick={handleDelete}>Eliminar</TBtn>
      </Toolbar>

      <div className="panel">
        <MetricStrip
          items={[
            { label: "Registros visibles", value: filtered.length },
            { label: "Base total", value: proveedores.length },
          ]}
        />
        <p className="status-text">{filtered.length} proveedores</p>
        <DataTable
          selectedId={selected?.id}
          onSelect={setSelected}
          columns={[
            { key: "razon_social", label: "Razón Social" },
            { key: "nit",          label: "NIT" },
            { key: "telefono",     label: "Teléfono" },
            { key: "correo",       label: "Correo" },
          ]}
          rows={filtered}
          maxHeight="calc(100vh - 300px)"
        />
      </div>

      {modal === "new"  && <ProveedorModal data={null}     onClose={() => setModal(null)} onSaved={reload} setError={setError} notify={notify} />}
      {modal === "edit" && <ProveedorModal data={selected} onClose={() => setModal(null)} onSaved={reload} setError={setError} notify={notify} />}
    </div>
  );
}

// ── Cuadre de Caja ────────────────────────────────────────────────────────────

function CajaView({ reload, setError, notify }) {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const currentYear = now.getFullYear();
  const [year,  setYear]  = useState(currentYear);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [hoy,   setHoy]   = useState(null);
  const [lista, setLista] = useState([]);
  const [ajustes, setAjustes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showAjusteForm, setShowAjusteForm] = useState(false);
  const [editing, setEditing]  = useState(null);

  const years = useMemo(() => Array.from({ length: 8 }, (_, i) => currentYear - 2 + i), [currentYear]);

  const loadCaja = useCallback(async () => {
    setLoading(true);
    try {
      const [hoyRes, listaRes, ajustesRes] = await Promise.allSettled([
        request("/api/caja/hoy"),
        request(`/api/caja?mes=${month}&ano=${year}`),
        request(`/api/caja/ajustes?mes=${month}&ano=${year}`),
      ]);
      if (hoyRes.status === "fulfilled") setHoy(hoyRes.value);
      if (listaRes.status === "fulfilled") setLista(listaRes.value);
      if (ajustesRes.status === "fulfilled") setAjustes(ajustesRes.value);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [month, year, setError]);

  useEffect(() => { loadCaja(); }, [loadCaja]);

  function handleEdit(c) { setEditing(c); setShowForm(true); }
  function handleNew()   { setEditing(hoy?.cuadre ?? null); setShowForm(true); }

  async function handleDelete(c) {
    if (!window.confirm(`¿Eliminar el registro de caja del ${c.fecha}?`)) return;
    try {
      await request(`/api/caja/${c.id}`, { method: "DELETE" });
      notify("Registro de caja eliminado.", "success");
      loadCaja();
    } catch (err) { setError(err.message); }
  }

  const movimientosHoy = hoy?.movimientos ?? { ingresos_caja: 0, egresos_caja: 0 };
  const entradasHoy = hoy?.detalle_movimientos?.entradas ?? [];
  const salidasHoy = hoy?.detalle_movimientos?.salidas ?? [];
  const apertura = hoy?.apertura;
  const saldoBaseHoy = hoy?.saldo_inicial_operativo ?? hoy?.cuadre?.saldo_inicial ?? hoy?.saldo_inicial_sugerido ?? 0;
  const saldoActualHoy = hoy?.saldo_actual ?? (saldoBaseHoy + (movimientosHoy.ingresos_caja || 0) - (movimientosHoy.egresos_caja || 0));
  const saldoContadoHoy = hoy?.saldo_contado ?? hoy?.cuadre?.saldo_real ?? null;
  const dif = hoy?.diferencia_arqueo ?? (saldoContadoHoy != null ? saldoContadoHoy - saldoActualHoy : null);
  const difColor = dif == null ? "#6b7280" : dif > 0 ? "#16a34a" : dif < 0 ? "#dc2626" : "#1e3a5f";
  const difLabel = dif == null ? "—" : dif > 0 ? `+${money(dif)}` : dif < 0 ? money(dif) : "Exacto";
  const totalEntradasMes = lista.reduce((sum, item) => sum + (item.ingresos_caja || 0), 0);
  const totalSalidasMes = lista.reduce((sum, item) => sum + (item.egresos_caja || 0), 0);
  const arqueosMes = lista.filter((item) => item.tiene_arqueo).length;
  const saldoVisibleMes = lista.length ? (lista[0].saldo_final ?? lista[0].saldo_esperado ?? 0) : 0;

  return (
    <div className="caja-root">
      {/* Header */}
      <div className="caja-header">
        <div>
          <h2 className="caja-title">Caja Continua</h2>
          <p className="caja-sub">La caja queda abierta y el saldo se arrastra automáticamente con cada entrada y salida en efectivo.</p>
        </div>
        <div className="caja-header-actions">
          <button className="caja-btn-secondary" onClick={() => setShowAjusteForm(true)}>
            + Ajuste Manual
          </button>
          <button className="caja-btn-primary" onClick={handleNew}>
            {apertura?.is_initial_opening && !apertura?.has_current_base
              ? "Registrar Apertura Inicial"
              : hoy?.cuadre
                ? "Ajustar Caja de Hoy"
                : "Abrir Caja de Hoy"}
          </button>
        </div>
      </div>

      {/* Panel Hoy */}
      {hoy && (
        <div className="caja-hoy-panel">
          <div className="caja-hoy-title">Hoy — {today}</div>
          <div className="caja-metrics">
            <div className="caja-metric">
              <span className="caja-metric-label">Saldo Base</span>
              <span className="caja-metric-val">{money(saldoBaseHoy)}</span>
            </div>
            <div className="caja-metric green">
              <span className="caja-metric-label">Ha Entrado</span>
              <span className="caja-metric-val">{money(movimientosHoy.ingresos_caja)}</span>
            </div>
            <div className="caja-metric red">
              <span className="caja-metric-label">Ha Salido</span>
              <span className="caja-metric-val">{money(movimientosHoy.egresos_caja)}</span>
            </div>
            <div className="caja-metric blue">
              <span className="caja-metric-label">Saldo Actual</span>
              <span className="caja-metric-val">{money(saldoActualHoy)}</span>
            </div>
            <div className="caja-metric purple">
              <span className="caja-metric-label">Conteo Físico</span>
              <span className="caja-metric-val">{saldoContadoHoy != null ? money(saldoContadoHoy) : <span className="caja-pending">Opcional</span>}</span>
            </div>
            <div className="caja-metric" style={{ "--dif-color": difColor }}>
              <span className="caja-metric-label">Ajuste</span>
              <span className="caja-metric-val" style={{ color: difColor, fontWeight: 700 }}>{difLabel}</span>
            </div>
          </div>
          <div className="caja-story">
            Con la base actual, hoy han entrado <strong>{money(movimientosHoy.ingresos_caja)}</strong>, han salido <strong>{money(movimientosHoy.egresos_caja)}</strong> y el saldo vivo estimado de la caja es <strong>{money(saldoActualHoy)}</strong>.
          </div>
          {apertura?.message && (
            <div className={`caja-apertura-note ${apertura?.is_initial_opening ? "initial" : ""}`}>
              {apertura.message}
            </div>
          )}
          {hoy.cuadre == null && (
            <div className="caja-alerta">
              No has fijado una base manual para hoy. Si no la ajustas, el sistema seguirá arrastrando automáticamente el saldo final del último día registrado.
            </div>
          )}
          {dif != null && dif !== 0 && (
            <div className={`caja-resultado ${dif > 0 ? "sobrante" : "faltante"}`}>
              {dif > 0
                ? `El conteo físico muestra ${money(dif)} por encima del saldo del sistema.`
                : `El conteo físico muestra ${money(Math.abs(dif))} por debajo del saldo del sistema.`}
            </div>
          )}
          {dif === 0 && (
            <div className="caja-resultado exacto">El conteo físico coincide exactamente con el saldo del sistema.</div>
          )}

          <div className="caja-flow-grid">
            <div className="caja-flow-card entradas">
              <div className="caja-flow-head">
                <strong>Qué Entró Hoy</strong>
                <span>{money(movimientosHoy.ingresos_caja)}</span>
              </div>
              {entradasHoy.length ? (
                <div className="caja-flow-list">
                  {entradasHoy.map((item) => (
                    <div key={item.id} className="caja-flow-row">
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.detalle}</span>
                      </div>
                      <b>{money(item.valor)}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="caja-flow-empty">Hoy no hay entradas en efectivo registradas.</div>
              )}
            </div>

            <div className="caja-flow-card salidas">
              <div className="caja-flow-head">
                <strong>Qué Salió Hoy</strong>
                <span>{money(movimientosHoy.egresos_caja)}</span>
              </div>
              {salidasHoy.length ? (
                <div className="caja-flow-list">
                  {salidasHoy.map((item) => (
                    <div key={item.id} className="caja-flow-row">
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.detalle}</span>
                      </div>
                      <b>{money(item.valor)}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="caja-flow-empty">Hoy no hay salidas en efectivo registradas.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filtros historial */}
      <div className="caja-filter-bar">
        <span className="caja-filter-label">Historial</span>
        <select value={month} onChange={(e) => setMonth(+e.target.value)} className="caja-select">
          {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(+e.target.value)} className="caja-select">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Tabla historial */}
      <div className="caja-table-wrap">
        {loading ? (
          <div className="caja-empty">Cargando...</div>
        ) : lista.length === 0 ? (
          <div className="caja-empty">Sin movimientos de caja guardados en este período.</div>
        ) : (
          <table className="caja-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Saldo Base</th>
                <th>Entró</th>
                <th>Salió</th>
                <th>Saldo Sistema</th>
                <th>Conteo Físico</th>
                <th>Ajuste</th>
                <th>Observaciones</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => {
                const d = c.diferencia;
                const rowClass = d == null ? "" : d > 0 ? "row-sobrante" : d < 0 ? "row-faltante" : "row-exacto";
                return (
                  <tr key={c.id} className={rowClass}>
                    <td>{c.fecha}</td>
                    <td>{money(c.saldo_inicial)}</td>
                    <td className="green">{money(c.ingresos_caja)}</td>
                    <td className="red">{money(c.egresos_caja)}</td>
                    <td>{money(c.saldo_final ?? c.saldo_esperado)}</td>
                    <td>{c.saldo_real != null ? money(c.saldo_real) : "—"}</td>
                    <td style={{ color: d == null ? "#6b7280" : d > 0 ? "#16a34a" : d < 0 ? "#dc2626" : "#1e3a5f", fontWeight: 600 }}>
                      {d == null ? "—" : d > 0 ? `+${money(d)}` : money(d)}
                    </td>
                    <td>{c.observaciones || "—"}</td>
                    <td className="caja-actions">
                      <button className="caja-btn-edit" onClick={() => handleEdit(c)}>Editar</button>
                      <button className="caja-btn-del" onClick={() => handleDelete(c)}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel-title">Ajustes Manuales de Caja</div>
        <p className="caja-adjuste-note">
          Los ajustes manuales quedan registrados con fecha, motivo y valor. Si necesitas corregir uno, registra otro ajuste compensatorio en lugar de borrar la historia.
        </p>
        <DataTable
          rows={ajustes}
          columns={[
            { key: "fecha", label: "Fecha" },
            { key: "tipo", label: "Tipo", render: (value) => value === "ENTRADA" ? "Entrada" : "Salida" },
            { key: "valor", label: "Valor", render: (value, row) => `${row.tipo === "ENTRADA" ? "+" : "-"}${money(value)}` },
            { key: "motivo", label: "Motivo" },
            { key: "observaciones", label: "Observaciones", render: (value) => value || "—" },
            { key: "created_at", label: "Registrado", render: (value) => value?.replace("T", " ").slice(0, 16) || "—" },
          ]}
          maxHeight="320px"
        />
      </div>

      {/* Resumen mes */}
      {lista.length > 0 && (() => {
        return (
          <div className="caja-resumen-mes">
            <div className="caja-res-item">
              <span>Días con Caja</span><strong>{lista.length}</strong>
            </div>
            <div className="caja-res-item">
              <span>Entradas del Mes</span><strong>{money(totalEntradasMes)}</strong>
            </div>
            <div className="caja-res-item green">
              <span>Saldo Final Visible</span><strong>{money(saldoVisibleMes)}</strong>
            </div>
            <div className="caja-res-item red">
              <span>Salidas del Mes</span><strong>{money(totalSalidasMes)}</strong>
            </div>
            <div className="caja-res-item">
              <span>Arqueos Físicos</span><strong>{arqueosMes}</strong>
            </div>
          </div>
        );
      })()}

      {/* Form modal */}
      {showForm && (
        <CajaFormModal
          data={editing}
          todayMovs={hoy?.movimientos}
          saldoSugerido={hoy?.saldo_inicial_operativo ?? hoy?.saldo_inicial_sugerido ?? 0}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); loadCaja(); reload(); notify("Caja actualizada.", "success"); }}
          setError={setError}
        />
      )}
      {showAjusteForm && (
        <CajaAjusteModal
          onClose={() => setShowAjusteForm(false)}
          onSaved={() => { setShowAjusteForm(false); loadCaja(); reload(); notify("Ajuste manual registrado.", "success"); }}
          setError={setError}
        />
      )}
    </div>
  );
}

function CajaFormModal({ data, todayMovs, saldoSugerido, onClose, onSaved, setError }) {
  const today = new Date().toISOString().slice(0, 10);
  const [fecha]       = useState(data?.fecha ?? today);
  const [saldoIni,  setSaldoIni]  = useState(data?.saldo_inicial ?? saldoSugerido ?? 0);
  const [saldoReal, setSaldoReal] = useState(data?.saldo_real ?? "");
  const [obs,       setObs]       = useState(data?.observaciones ?? "");
  const [saving, setSaving] = useState(false);

  const ingresos = data?.ingresos_caja ?? todayMovs?.ingresos_caja ?? 0;
  const egresos  = data?.egresos_caja  ?? todayMovs?.egresos_caja  ?? 0;
  const esperado = (parseFloat(saldoIni) || 0) + ingresos - egresos;
  const real     = saldoReal !== "" ? parseFloat(saldoReal) : null;
  const dif      = real != null ? real - esperado : null;

  async function handleSave() {
    if (saldoIni === "" || saldoIni === null) { setError("El saldo inicial es obligatorio."); return; }
    setSaving(true);
    try {
      const payload = { fecha, saldo_inicial: parseFloat(saldoIni) || 0, saldo_real: real, observaciones: obs };
      if (data?.id) {
        await request(`/api/caja/${data.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await request("/api/caja", { method: "POST", body: JSON.stringify(payload) });
      }
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="caja-modal">
        <div className="caja-modal-header">
          <h3>{data ? "Ajustar Caja del Día" : "Abrir Caja del Día"}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="caja-modal-body">
          <div className="caja-field">
            <label>Fecha</label>
            <input type="text" value={fecha} readOnly className="caja-input readonly" />
          </div>

          <div className="caja-field">
            <label>Saldo base de caja <span className="caja-hint">(disponible al arrancar el día)</span></label>
            <input type="number" value={saldoIni} onChange={(e) => setSaldoIni(e.target.value)}
                   className="caja-input" placeholder="0" min="0" />
          </div>

          <div className="caja-info-box">
            <p className="caja-info-title">Movimientos del día (automáticos)</p>
            <div className="caja-info-row">
              <span>Ingresos en caja</span>
              <strong style={{ color: "#16a34a" }}>{money(ingresos)}</strong>
            </div>
            <div className="caja-info-row">
              <span>Egresos en caja</span>
              <strong style={{ color: "#dc2626" }}>{money(egresos)}</strong>
            </div>
            <p className="caja-info-note">Los egresos en caja son los registrados con canal de pago "Caja"</p>
          </div>

          <div className="caja-field">
            <label>Conteo físico opcional <span className="caja-hint">(solo si quieres comparar el efectivo real contra el sistema)</span></label>
            <input type="number" value={saldoReal} onChange={(e) => setSaldoReal(e.target.value)}
                   className="caja-input" placeholder="Déjalo vacío si no vas a hacer arqueo" min="0" />
          </div>

          <div className="caja-field">
            <label>Observaciones</label>
            <input type="text" value={obs} onChange={(e) => setObs(e.target.value)}
                   className="caja-input" placeholder="Opcional" />
          </div>

          <div className={`caja-live-result ${dif == null ? "" : dif > 0 ? "sobrante" : dif < 0 ? "faltante" : "exacto"}`}>
            <div className="caja-live-row">
              <span>Entró hoy</span>
              <strong>{money(ingresos)}</strong>
            </div>
            <div className="caja-live-row">
              <span>Salió hoy</span>
              <strong>{money(egresos)}</strong>
            </div>
            <div className="caja-live-row">
              <span>Saldo actual del sistema</span>
              <strong>{money(esperado)}</strong>
            </div>
            {dif != null && (
              <div className="caja-live-row highlight">
                <span>{dif > 0 ? "El conteo físico está por encima" : dif < 0 ? "El conteo físico está por debajo" : "El conteo físico coincide"}</span>
                <strong>{dif !== 0 ? money(Math.abs(dif)) : "✓"}</strong>
              </div>
            )}
          </div>
        </div>

        <div className="caja-modal-footer">
          <button className="btn-cancel" onClick={onClose}>Cancelar</button>
          <button className="btn-save" onClick={handleSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar Caja"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CajaAjusteModal({ onClose, onSaved, setError }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    fecha: today,
    tipo: "SALIDA",
    valor: "",
    motivo: "",
    observaciones: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function handleSave() {
    if (!form.motivo.trim()) {
      setError("Debes escribir el motivo del ajuste manual.");
      return;
    }
    setSaving(true);
    try {
      await request("/api/caja/ajustes", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          valor: Number(form.valor || 0),
        }),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="caja-modal">
        <div className="caja-modal-header">
          <h3>Registrar Ajuste Manual</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="caja-modal-body">
          <div className="caja-adjuste-warning">
            Usa este registro cuando debas reconocer una pérdida o corrección manual en caja. El movimiento quedará trazado en auditoría.
          </div>

          <div className="caja-field">
            <label>Fecha</label>
            <input type="date" value={form.fecha} onChange={set("fecha")} className="caja-input" />
          </div>

          <div className="caja-field">
            <label>Tipo de ajuste</label>
            <select value={form.tipo} onChange={set("tipo")} className="caja-input">
              <option value="SALIDA">Salida de caja</option>
              <option value="ENTRADA">Entrada de caja</option>
            </select>
          </div>

          <div className="caja-field">
            <label>Valor</label>
            <input type="number" min="0" value={form.valor} onChange={set("valor")} className="caja-input" placeholder="0" />
          </div>

          <div className="caja-field">
            <label>Motivo</label>
            <input value={form.motivo} onChange={set("motivo")} className="caja-input" placeholder="Ej. pérdida no explicada en arqueo" />
          </div>

          <div className="caja-field">
            <label>Observaciones</label>
            <textarea value={form.observaciones} onChange={set("observaciones")} className="caja-input" rows="3" placeholder="Detalles adicionales del ajuste" />
          </div>
        </div>

        <div className="caja-modal-footer">
          <button className="btn-cancel" onClick={onClose}>Cancelar</button>
          <button className="btn-save" onClick={handleSave} disabled={saving}>
            {saving ? "Registrando..." : "Registrar Ajuste"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Análisis de Ingresos ──────────────────────────────────────────────────────

const CANAL_COLORS = { "Caja": "#1e3a5f", "Bancos": "#2563eb", "Tarjeta CR": "#7c3aed" };
const CANAL_LIGHT  = { "Caja": "#dbeafe",  "Bancos": "#ede9fe",  "Tarjeta CR": "#f3e8ff" };

function AnalisisIngresos({ analisis }) {
  if (!analisis) return null;
  const { canales, meses, total_global, meses_con_datos } = analisis;
  const lider = canales[0];

  // Para la tabla por año: agrupa meses en años
  const porAno = meses.reduce((acc, m) => {
    const ano = m.mes.slice(0, 4);
    if (!acc[ano]) acc[ano] = { ano, caja: 0, bancos: 0, tarjeta_cr: 0, total: 0, meses: 0 };
    acc[ano].caja      += m.caja;
    acc[ano].bancos    += m.bancos;
    acc[ano].tarjeta_cr += m.tarjeta_cr;
    acc[ano].total     += m.total;
    acc[ano].meses     += 1;
    return acc;
  }, {});
  const anosData = Object.values(porAno).sort((a, b) => a.ano.localeCompare(b.ano));

  return (
    <div className="analisis-root">
      {/* Header */}
      <div className="analisis-header">
        <div>
          <h3 className="analisis-title">Análisis de Canales de Ingreso</h3>
          <p className="analisis-sub">
            Basado en {meses_con_datos} meses con datos · Total histórico: <strong>{money(total_global)}</strong>
          </p>
        </div>
        <div className="analisis-lider-badge" style={{ background: CANAL_COLORS[lider?.canal], color: "white" }}>
          Canal líder: {lider?.canal} · {lider?.pct}%
        </div>
      </div>

      {/* Canal cards */}
      <div className="analisis-canales">
        {canales.map((c, i) => (
          <div key={c.canal} className="analisis-canal-card" style={{ borderTopColor: CANAL_COLORS[c.canal] }}>
            <div className="analisis-canal-top">
              <span className="analisis-canal-name" style={{ color: CANAL_COLORS[c.canal] }}>{c.canal}</span>
              {i === 0 && <span className="analisis-canal-crown">★ Líder</span>}
            </div>
            <strong className="analisis-canal-total">{money(c.total)}</strong>
            <div className="analisis-bar-track">
              <div
                className="analisis-bar-fill"
                style={{ width: `${c.pct}%`, background: CANAL_COLORS[c.canal] }}
              />
            </div>
            <div className="analisis-canal-stats">
              <span><b>{c.pct}%</b> del total</span>
              <span>Prom. mensual: <b>{money(c.promedio_mensual)}</b></span>
            </div>
          </div>
        ))}
      </div>

      {/* Tabla mes a mes */}
      <div className="panel">
        <h4 className="panel-title">Detalle por mes</h4>
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Días</th>
                <th style={{ color: "#93c5fd" }}>Caja</th>
                <th style={{ color: "#c4b5fd" }}>Bancos</th>
                <th style={{ color: "#f0abfc" }}>Tarjeta CR</th>
                <th>Total</th>
                <th>Canal líder del mes</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((m) => {
                const liderMes = [
                  { canal: "Caja", val: m.caja },
                  { canal: "Bancos", val: m.bancos },
                  { canal: "Tarjeta CR", val: m.tarjeta_cr },
                ].sort((a, b) => b.val - a.val)[0];
                return (
                  <tr key={m.mes}>
                    <td><strong>{m.mes}</strong></td>
                    <td style={{ textAlign: "center" }}>{m.dias}</td>
                    <td>{money(m.caja)}</td>
                    <td>{money(m.bancos)}</td>
                    <td>{money(m.tarjeta_cr)}</td>
                    <td><strong>{money(m.total)}</strong></td>
                    <td>
                      <span className="analisis-mes-lider" style={{ background: CANAL_LIGHT[liderMes.canal], color: CANAL_COLORS[liderMes.canal] }}>
                        {liderMes.canal}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Consolidado por año */}
      <div className="panel">
        <h4 className="panel-title">Consolidado por año</h4>
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Año</th>
                <th>Meses</th>
                <th style={{ color: "#93c5fd" }}>Caja</th>
                <th style={{ color: "#c4b5fd" }}>Bancos</th>
                <th style={{ color: "#f0abfc" }}>Tarjeta CR</th>
                <th>Total año</th>
                <th>Prom. mensual</th>
              </tr>
            </thead>
            <tbody>
              {anosData.map((a) => (
                <tr key={a.ano}>
                  <td><strong>{a.ano}</strong></td>
                  <td style={{ textAlign: "center" }}>{a.meses}</td>
                  <td>{money(a.caja)}</td>
                  <td>{money(a.bancos)}</td>
                  <td>{money(a.tarjeta_cr)}</td>
                  <td><strong>{money(a.total)}</strong></td>
                  <td>{money(Math.round(a.total / a.meses))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Ingresos ──────────────────────────────────────────────────────────────────

const EMPTY_ING = {
  fecha: new Date().toISOString().slice(0, 10),
  caja: "", bancos: "", tarjeta_cr: "",
};

function IngresoModal({ data, onClose, onSaved, setError, notify }) {
  const [form, setForm] = useState({ ...EMPTY_ING, ...(data || {}) });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    try {
      setSaving(true);
      const body = {
        fecha: form.fecha,
        caja:      Number(form.caja      || 0),
        bancos:    Number(form.bancos    || 0),
        tarjeta_cr: Number(form.tarjeta_cr || 0),
      };
      if (data?.id)
        await request(`/api/ingresos/${data.id}`, { method: "PUT", body: JSON.stringify(body) });
      else
        await request("/api/ingresos", { method: "POST", body: JSON.stringify(body) });
      onSaved();
      notify(data?.id ? "Ingreso actualizado" : "Ingreso registrado", "success");
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={data?.id ? "Editar Ingreso" : "Nuevo Ingreso"} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <Field label="Fecha (YYYY-MM-DD)">
          <input required type="date" value={form.fecha} onChange={set("fecha")} />
        </Field>
        <Field label="Caja ($)">
          <input type="number" min="0" value={form.caja} onChange={set("caja")} />
        </Field>
        <Field label="Bancos ($)">
          <input type="number" min="0" value={form.bancos} onChange={set("bancos")} />
        </Field>
        <Field label="Tarjeta CR ($)">
          <input type="number" min="0" value={form.tarjeta_cr} onChange={set("tarjeta_cr")} />
        </Field>
        <div className="modal-footer">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn-save btn-green" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

function IngresosView({ ingresos, year, month, setYear, setMonth, years, periodClosed, analisis, reload, setError, notify }) {
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null);
  const [showAnalisis, setShowAnalisis] = useState(false);

  const totals = ingresos.reduce(
    (acc, r) => ({
      caja:    acc.caja    + (r.caja      || 0),
      bancos:  acc.bancos  + (r.bancos    || 0),
      tarjeta: acc.tarjeta + (r.tarjeta_cr || 0),
    }),
    { caja: 0, bancos: 0, tarjeta: 0 }
  );
  const gran = totals.caja + totals.bancos + totals.tarjeta;

  async function handleDelete() {
    if (!selected) { alert("Selecciona un registro para eliminar."); return; }
    if (!window.confirm("¿Eliminar este ingreso?")) return;
    try {
      await request(`/api/ingresos/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      reload();
      notify("Ingreso eliminado", "success");
    } catch (err) { setError(err.message); }
  }

  async function handleExport() {
    await downloadExcelFile(`/api/export/ingresos?mes=${month}&ano=${year}`, `Ingresos_${month}_${year}.xlsx`, setError, notify);
  }

  return (
    <div className="page-view">
      <Toolbar title="Ingresos">
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <TBtn tone="navy" onClick={handleExport}>Exportar Excel</TBtn>
        <TBtn tone="purple" onClick={() => setShowAnalisis((v) => !v)}>
          {showAnalisis ? "Ocultar análisis" : "Ver análisis"}
        </TBtn>
        <TBtn tone="green" onClick={() => setModal("new")} disabled={periodClosed}>+ Nuevo</TBtn>
        <TBtn tone="blue" onClick={() => {
          if (!selected) { alert("Selecciona un registro para editar."); return; }
          setModal("edit");
        }} disabled={periodClosed}>Editar</TBtn>
        <TBtn tone="red" onClick={handleDelete} disabled={periodClosed}>Eliminar</TBtn>
      </Toolbar>

      <div className="panel">
        {periodClosed && <p className="status-text"><strong>Período cerrado.</strong> Los ingresos de este mes están bloqueados para edición.</p>}
        <MetricStrip
          items={[
            { label: "Caja", value: money(totals.caja) },
            { label: "Bancos", value: money(totals.bancos) },
            { label: "Tarjeta", value: money(totals.tarjeta) },
            { label: "Total", value: money(gran) },
          ]}
        />
        <p className="status-text">
          {ingresos.length} días &nbsp;|&nbsp;
          Caja: {money(totals.caja)} &nbsp;
          Bancos: {money(totals.bancos)} &nbsp;
          Tarjeta: {money(totals.tarjeta)} &nbsp;
          <strong>TOTAL: {money(gran)}</strong>
        </p>
        <DataTable
          selectedId={selected?.id}
          onSelect={setSelected}
          columns={[
            { key: "fecha",      label: "Fecha" },
            { key: "caja",       label: "Caja",       render: (v) => money(v) },
            { key: "bancos",     label: "Bancos",     render: (v) => money(v) },
            { key: "tarjeta_cr", label: "Tarjeta CR", render: (v) => money(v) },
            {
              key: "_total", label: "Total Día",
              render: (_, row) => money((row.caja || 0) + (row.bancos || 0) + (row.tarjeta_cr || 0)),
            },
          ]}
          rows={ingresos}
          maxHeight="calc(100vh - 300px)"
        />
      </div>

      {showAnalisis && <AnalisisIngresos analisis={analisis} />}

      {modal === "new"  && <IngresoModal data={null}     onClose={() => setModal(null)} onSaved={reload} setError={setError} notify={notify} />}
      {modal === "edit" && <IngresoModal data={selected} onClose={() => setModal(null)} onSaved={reload} setError={setError} notify={notify} />}
    </div>
  );
}

// ── Egresos ───────────────────────────────────────────────────────────────────

const TIPO_GASTO_OPTS = ["COSTO","GASTO","SERVICIOS","EMPLEADO","SEG SOCIAL"];

const EMPTY_EG = {
  fecha: new Date().toISOString().slice(0, 10),
  no_documento: "", razon_social: "", nit: "", valor: "",
  tipo_gasto: "COSTO", canal_pago: "Otro", factura_electronica: "NO", observaciones: "", has_support: false, soporte_name: "",
};

function egresoTipoClass(tipo) {
  const normalized = String(tipo || "").toUpperCase();
  if (normalized === "COSTO") return "violet";
  if (normalized === "GASTO") return "slate";
  if (normalized === "SERVICIOS") return "amber";
  if (normalized === "EMPLEADO") return "blue";
  if (normalized === "SEG SOCIAL") return "rose";
  return "slate";
}

function EgresosLedgerTable({ rows, selectedId, onSelect }) {
  return (
    <div className="ledger-shell">
      <div className="ledger-table-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>N° Doc</th>
              <th>Proveedor / Razón</th>
              <th>NIT</th>
              <th>Valor</th>
              <th>Naturaleza G.</th>
              <th>Factura</th>
              <th>Soporte</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr
                key={row.id}
                className={row.id === selectedId ? "is-selected" : ""}
                onClick={() => onSelect?.(row)}
              >
                <td>{row.fecha}</td>
                <td className="ledger-doc">{row.no_documento || "Sin doc."}</td>
                <td>
                  <div className="ledger-vendor">
                    <div className="ledger-avatar">
                      {(row.razon_social || "?").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="ledger-vendor-text">
                      <strong>{row.razon_social || "Sin proveedor"}</strong>
                      <span>{row.observaciones || "Registro contable"}</span>
                    </div>
                  </div>
                </td>
                <td>{row.nit || "NIT N/A"}</td>
                <td className="ledger-value">{money(row.valor)}</td>
                <td>
                  <span className={`ledger-badge ${egresoTipoClass(row.tipo_gasto)}`}>
                    {row.tipo_gasto || "OTRO"}
                  </span>
                </td>
                <td className="ledger-center">
                  <span className={`ledger-factura ${row.factura_electronica === "SI" ? "yes" : "no"}`}>
                    {row.factura_electronica === "SI" ? "Sí" : "No"}
                  </span>
                </td>
                <td className="ledger-center">
                  <span className={`ledger-factura ${row.has_support ? "yes" : "no"}`}>
                    {row.has_support ? "Adjunto" : "Sin soporte"}
                  </span>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={8} className="ledger-empty">
                  <div className="ledger-empty-block">
                    <strong>No se encontraron egresos</strong>
                    <span>Comienza registrando un movimiento para ver el libro mayor en tiempo real.</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const EMPTY_NOVEDAD = {
  fecha: new Date().toISOString().slice(0, 10),
  empleado: "",
  cedula: "",
  quincena: "Q1",
  naturaleza: "DEVENGADO",
  tipo_novedad: "BONIFICACION",
  valor: "",
  observaciones: "",
};

const EMPTY_ASISTENCIA = {
  empleado: "",
  cedula: "",
  dia: "",
  quincena: "Q1",
  estado: "LABORADO",
};

function AsistenciaModal({ periodo, data, onClose, onSaved, setError, notify }) {
  const [form, setForm] = useState({ ...EMPTY_ASISTENCIA, ...(data || {}) });
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    try {
      setSaving(true);
      const payload = {
        ...form,
        periodo,
        dia: Number(form.dia),
      };
      if (data?.id) {
        await request(`/api/nomina/asistencia/${data.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await request("/api/nomina/asistencia", { method: "POST", body: JSON.stringify(payload) });
      }
      onSaved();
      notify(data?.id ? "Asistencia actualizada" : "Asistencia registrada", "success");
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={data?.id ? "Editar Asistencia" : "Nueva Asistencia"} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <Field label="Empleado">
          <input required value={form.empleado} onChange={set("empleado")} />
        </Field>
        <Field label="Cédula">
          <input value={form.cedula} onChange={set("cedula")} />
        </Field>
        <Field label="Día">
          <input required type="number" min="1" max="31" value={form.dia} onChange={set("dia")} />
        </Field>
        <Field label="Quincena">
          <select value={form.quincena} onChange={set("quincena")}>
            <option value="Q1">Q1</option>
            <option value="Q2">Q2</option>
          </select>
        </Field>
        <Field label="Estado">
          <select value={form.estado} onChange={set("estado")}>
            <option value="LABORADO">LABORADO</option>
            <option value="DOMINGO_FESTIVO">DOMINGO / FESTIVO</option>
            <option value="NO_FUE">NO FUE</option>
            <option value="INCAPACIDAD">INCAPACIDAD</option>
            <option value="PERMISO_NO_REMUNERADO">PERMISO NO REMUNERADO</option>
            <option value="CITA_MEDICA">CITA MÉDICA</option>
            <option value="VACACIONES">VACACIONES</option>
          </select>
        </Field>
        <div className="modal-footer">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn-save" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

function NovedadModal({ periodo, data, onClose, onSaved, setError, notify }) {
  const [form, setForm] = useState({ ...EMPTY_NOVEDAD, ...(data || {}) });
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    try {
      setSaving(true);
      const payload = {
        ...form,
        periodo,
        valor: Number(form.valor || 0),
      };
      if (data?.id) {
        await request(`/api/nomina/novedades/${data.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await request("/api/nomina/novedades", { method: "POST", body: JSON.stringify(payload) });
      }
      onSaved();
      notify(data?.id ? "Novedad actualizada" : "Novedad creada", "success");
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={data?.id ? "Editar Novedad" : "Nueva Novedad"} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <Field label="Fecha">
          <input required type="date" value={form.fecha} onChange={set("fecha")} />
        </Field>
        <Field label="Empleado">
          <input required value={form.empleado} onChange={set("empleado")} />
        </Field>
        <Field label="Cédula">
          <input value={form.cedula} onChange={set("cedula")} />
        </Field>
        <Field label="Quincena">
          <select value={form.quincena} onChange={set("quincena")}>
            <option value="Q1">Q1</option>
            <option value="Q2">Q2</option>
            <option value="MES">MES</option>
          </select>
        </Field>
        <Field label="Naturaleza">
          <select value={form.naturaleza} onChange={set("naturaleza")}>
            <option value="DEVENGADO">DEVENGADO</option>
            <option value="DEDUCCION">DEDUCCION</option>
          </select>
        </Field>
        <Field label="Tipo de novedad">
          <input required value={form.tipo_novedad} onChange={set("tipo_novedad")} />
        </Field>
        <Field label="Valor">
          <input required type="number" min="1" value={form.valor} onChange={set("valor")} />
        </Field>
        <Field label="Observaciones">
          <textarea rows={3} value={form.observaciones} onChange={set("observaciones")} />
        </Field>
        <div className="modal-footer">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn-save" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

function EgresoModal({ data, proveedores, onClose, onSaved, setError, notify }) {
  const [form, setForm] = useState({ ...EMPTY_EG, ...(data || {}) });
  const [saving, setSaving] = useState(false);
  const [supportFile, setSupportFile] = useState(null);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const proveedoresOrdenados = useMemo(
    () => [...(proveedores || [])].sort((a, b) => String(a.razon_social || "").localeCompare(String(b.razon_social || ""), "es")),
    [proveedores]
  );

  function handleProveedorChange(e) {
    const razonSocial = e.target.value;
    const proveedor = proveedoresOrdenados.find((item) => item.razon_social === razonSocial);
    setForm((prev) => ({
      ...prev,
      razon_social: razonSocial,
      nit: proveedor?.nit || "",
      proveedor_id: proveedor?.id ?? null,
    }));
  }

  async function submit(e) {
    e.preventDefault();
    try {
      setSaving(true);
      const proveedor = proveedoresOrdenados.find((item) => item.razon_social === form.razon_social);
      const body = {
        ...form,
        valor: Number(form.valor || 0),
        consecutivo: "",
        proveedor_id: proveedor?.id ?? form.proveedor_id ?? null,
        nit: proveedor?.nit || form.nit || "",
      };
      if (data?.id)
        await request(`/api/egresos/${data.id}`, { method: "PUT", body: JSON.stringify(body) });
      else
        body.id = (await request("/api/egresos", { method: "POST", body: JSON.stringify(body) }))?.id;
      const entityId = data?.id || body.id;
      if (supportFile && entityId) {
        await uploadSupportFile(`/api/egresos/${entityId}/soporte`, supportFile, setError, notify);
      }
      onSaved();
      notify(data?.id ? "Egreso actualizado" : "Egreso registrado", "success");
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={data?.id ? "Editar Egreso" : "Nuevo Egreso"} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <Field label="Fecha">
          <input required type="date" value={form.fecha} onChange={set("fecha")} />
        </Field>
        <Field label="N° Documento">
          <input value={form.no_documento} onChange={set("no_documento")} />
        </Field>
        <Field label="Proveedor / Razón Social *">
          <select required value={form.razon_social} onChange={handleProveedorChange}>
            <option value="">Selecciona un proveedor</option>
            {proveedoresOrdenados.map((proveedor) => (
              <option key={proveedor.id} value={proveedor.razon_social}>
                {proveedor.razon_social}
              </option>
            ))}
          </select>
        </Field>
        <Field label="NIT">
          <input value={form.nit} onChange={set("nit")} readOnly />
        </Field>
        <Field label="Valor *">
          <input required type="number" min="1" value={form.valor} onChange={set("valor")} />
        </Field>
        <Field label="Naturaleza del Gasto">
          <select value={form.tipo_gasto} onChange={set("tipo_gasto")}>
            {TIPO_GASTO_OPTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Canal de Pago">
          <select value={form.canal_pago ?? "Otro"} onChange={set("canal_pago")}>
            <option value="Caja">Caja (efectivo)</option>
            <option value="Bancos">Bancos</option>
            <option value="Tarjeta CR">Tarjeta CR</option>
            <option value="Otro">Otro</option>
          </select>
        </Field>
        <Field label="Factura Electrónica">
          <select value={form.factura_electronica} onChange={set("factura_electronica")}>
            <option value="NO">No</option>
            <option value="SI">Sí</option>
          </select>
        </Field>
        <Field label="Observaciones">
          <textarea value={form.observaciones} onChange={set("observaciones")} rows={3} />
        </Field>
        <Field label="Soporte documental">
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setSupportFile(e.target.files?.[0] || null)} />
          {data?.soporte_name && <small>Actual: {data.soporte_name}</small>}
        </Field>
        <div className="modal-footer">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn-save" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

function EgresosView({ egresos, proveedores, year, month, setYear, setMonth, years, periodClosed, reload, setError, notify }) {
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState("Todos");
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null);
  const deferredSearch = useDeferredValue(search);

  const tipos = useMemo(() => (
    ["Todos", ...Array.from(new Set(egresos.map((e) => e.tipo_gasto).filter(Boolean)))]
  ), [egresos]);

  const filtered = egresos.filter((e) => {
    const matchTipo   = tipoFilter === "Todos" || e.tipo_gasto === tipoFilter;
    const matchSearch = !search ||
      `${e.razon_social} ${e.nit} ${e.no_documento}`.toLowerCase().includes(deferredSearch.toLowerCase());
    return matchTipo && matchSearch;
  });

  const totalVisible = filtered.reduce((acc, row) => acc + Number(row.valor || 0), 0);
  const facturaCount = filtered.filter((row) => row.factura_electronica === "SI").length;
  const topTipo = Object.entries(filtered.reduce((acc, row) => {
    const key = row.tipo_gasto || "OTRO";
    acc[key] = (acc[key] || 0) + Number(row.valor || 0);
    return acc;
  }, {})).sort((a, b) => b[1] - a[1])[0]?.[0] || "Sin datos";

  async function handleDelete() {
    if (!selected) { alert("Selecciona un egreso para eliminar."); return; }
    if (!window.confirm("¿Eliminar este egreso?")) return;
    try {
      await request(`/api/egresos/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      reload();
      notify("Egreso eliminado", "success");
    } catch (err) { setError(err.message); }
  }

  async function handleExport() {
    const params = new URLSearchParams({ mes: String(month), ano: String(year) });
    if (tipoFilter && tipoFilter !== "Todos") params.set("tipo", tipoFilter);
    if (search.trim()) params.set("search", search.trim());
    await downloadExcelFile(`/api/export/egresos?${params.toString()}`, `Egresos_${month}_${year}.xlsx`, setError, notify);
  }

  return (
    <div className="page-view">
      <div className="egresos-hero">
        <div className="egresos-hero-card primary">
          <span className="eyebrow">Total visible</span>
          <strong>{money(totalVisible)}</strong>
          <p>Calculado sobre {filtered.length} transacciones visibles.</p>
        </div>
        <div className="egresos-hero-card">
          <span className="eyebrow">Registros</span>
          <strong>{filtered.length}</strong>
          <p>{Math.max(tipos.length - 1, 0)} naturalezas distintas en pantalla.</p>
        </div>
        <div className="egresos-hero-card">
          <span className="eyebrow">Naturaleza líder</span>
          <strong>{topTipo}</strong>
          <p>{facturaCount} movimientos con factura electrónica.</p>
        </div>
      </div>

      <div className="egresos-controls">
        <div className="egresos-controls-left">
          <div className="egresos-control-chip">
            <span>{MONTH_NAMES[month - 1]} {year}</span>
          </div>
          <input className="search-input egresos-search" placeholder="Buscar proveedor, NIT o documento..." value={search}
            onChange={(e) => setSearch(e.target.value)} />
          <select value={tipoFilter} onChange={(e) => setTipoFilter(e.target.value)}>
            {tipos.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="egresos-controls-right">
          <button type="button" className="egresos-icon-btn" onClick={handleExport}>Exportar Excel</button>
          <button
            type="button"
            className="egresos-icon-btn"
            disabled={!selected?.has_support}
            onClick={() => openProtectedFile(`/api/egresos/${selected.id}/soporte`, selected?.soporte_name || `soporte_${selected?.id}`, setError)}
          >
            Ver Soporte
          </button>
          <button type="button" className="egresos-icon-btn" disabled={periodClosed} onClick={() => {
            if (!selected) { alert("Selecciona un egreso para editar."); return; }
            setModal("edit");
          }}>Editar</button>
          <button type="button" className="egresos-icon-btn danger" disabled={periodClosed} onClick={handleDelete}>Eliminar</button>
          <button type="button" className="egresos-primary-btn" disabled={periodClosed} onClick={() => setModal("new")}>Registrar Egreso</button>
        </div>
      </div>

      <div className="panel egresos-ledger-panel">
        <div className="egresos-ledger-head">
          <div>
            <h3 className="panel-title">Libro de Egresos</h3>
            <p className="status-text">
              {filtered.length} registros visibles. {periodClosed ? "Período cerrado para edición." : "Selecciona una fila para editar o eliminar."}
            </p>
          </div>
          {selected && (
            <div className="egresos-selection-chip">
              Seleccionado: {(selected.razon_social || "Sin proveedor").slice(0, 34)}
            </div>
          )}
        </div>

        <EgresosLedgerTable
          rows={filtered}
          selectedId={selected?.id}
          onSelect={setSelected}
        />
      </div>

      {modal === "new"  && <EgresoModal data={null} proveedores={proveedores} onClose={() => setModal(null)} onSaved={reload} setError={setError} notify={notify} />}
      {modal === "edit" && <EgresoModal data={selected} proveedores={proveedores} onClose={() => setModal(null)} onSaved={reload} setError={setError} notify={notify} />}
    </div>
  );
}

// ── Nómina ────────────────────────────────────────────────────────────────────

function NominaView({ nomina, periodoNomina, setPeriodoNomina, reload, setError, notify }) {
  const stats = nomina.stats || {};
  const resumen = nomina.resumen || [];
  const asistencia = nomina.asistencia || [];
  const asistenciaResumen = nomina.asistencia_resumen || [];
  const seg = nomina.seg_social || [];
  const novedades = nomina.novedades || [];
  const workflow = nomina.workflow || { steps: [] };
  const [selectedAsistencia, setSelectedAsistencia] = useState(null);
  const [selectedNovedad, setSelectedNovedad] = useState(null);
  const [novedadModal, setNovedadModal] = useState(null);
  const [asistenciaModal, setAsistenciaModal] = useState(null);
  const totalDesembolso = resumen.reduce((acc, row) => acc + Number(row.total_mes || 0), 0);
  const pendientes = novedades.filter((row) => String(row.tipo_novedad || "").trim()).length;
  const topEmpleado = [...resumen].sort((a, b) => Number(b.total_mes || 0) - Number(a.total_mes || 0))[0];

  const socialGroups = Object.values(seg.reduce((acc, row) => {
    const key = row.grupo || row.concepto || "OTRO";
    if (!acc[key]) {
      acc[key] = { concepto: key, empresa: 0, empleado: 0 };
    }
    const valor = Number(row.valor || 0);
    acc[key].empresa += valor;
    if (/eps|pension|salud/i.test(String(row.concepto || ""))) {
      acc[key].empleado += valor * 0.32;
    }
    return acc;
  }, {}));

  const workflowGuide = [
    {
      key: "asistencia",
      stepNumber: 1,
      title: "Preparar base del período",
      short: "Carga los días o soportes del período antes de liquidar.",
      action: "Registrar soporte diario",
    },
    {
      key: "liquidacion",
      stepNumber: 2,
      title: "Revisar liquidación por empleado",
      short: "Confirma días, valores y netos de Q1 y Q2.",
      action: "Validar liquidación",
    },
    {
      key: "novedades",
      stepNumber: 3,
      title: "Aplicar novedades",
      short: "Agrega bonificaciones, descuentos o ajustes manuales.",
      action: "Registrar novedad",
    },
    {
      key: "seg_social",
      stepNumber: 4,
      title: "Validar seguridad social",
      short: "Revisa aportes patronales y totales del período.",
      action: "Revisar conceptos",
    },
    {
      key: "integracion",
      stepNumber: 5,
      title: "Sincronizar y cerrar",
      short: "Lleva la nómina a egresos contables y deja listo el cierre.",
      action: "Sincronizar egresos",
    },
  ].map((guide) => {
    const real = (workflow.steps || []).find((step) => step.step === guide.key) || {};
    return {
      ...guide,
      completed: !!real.completed,
      count: real.count ?? 0,
      detail: real.detail || guide.short,
    };
  });

  const nextStep = workflowGuide.find((step) => !step.completed) || workflowGuide[workflowGuide.length - 1];

  function jumpToNominaSection(sectionId) {
    const node = document.getElementById(sectionId);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function handleSync() {
    try {
      const result = await request("/api/nomina/sync", {
        method: "POST",
        body: JSON.stringify({ periodo: periodoNomina || null }),
      });
      reload();
      notify(`Nómina sincronizada. ${result.egresos_generados ?? 0} egresos generados.`, "success");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteNovedad() {
    if (!selectedNovedad) {
      alert("Selecciona una novedad para eliminar.");
      return;
    }
    if (!window.confirm("¿Eliminar esta novedad?")) return;
    try {
      await request(`/api/nomina/novedades/${selectedNovedad.id}`, { method: "DELETE" });
      setSelectedNovedad(null);
      reload();
      notify("Novedad eliminada", "success");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteAsistencia() {
    if (!selectedAsistencia) {
      alert("Selecciona un registro de asistencia para eliminar.");
      return;
    }
    if (!window.confirm("¿Eliminar este registro de asistencia?")) return;
    try {
      await request(`/api/nomina/asistencia/${selectedAsistencia.id}`, { method: "DELETE" });
      setSelectedAsistencia(null);
      reload();
      notify("Asistencia eliminada", "success");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleExportNomina() {
    if (!periodoNomina) {
      setError("Selecciona un período de nómina para exportar.");
      return;
    }
    await downloadExcelFile(
      `/api/export/nomina?periodo=${encodeURIComponent(periodoNomina)}`,
      `Nomina_${periodoNomina.replaceAll(" ", "_")}.xlsx`,
      setError,
      notify
    );
  }

  return (
    <div className="page-view nomina-view">
      <div className="nomina-header">
        <div>
          <div className="nomina-breadcrumb">Morsa / Gestión de Nómina</div>
          <h2 className="nomina-title">Consolidado Mensual</h2>
        </div>
        <div className="nomina-header-actions">
          <select value={periodoNomina} onChange={(e) => setPeriodoNomina(e.target.value)}>
            {(nomina.periodos || []).map((p) => <option key={p}>{p}</option>)}
          </select>
          <button type="button" className="nomina-ghost-btn" onClick={handleExportNomina}>Exportar Excel</button>
          <button type="button" className="nomina-ghost-btn" onClick={() => setAsistenciaModal("new")}>Nueva Asistencia</button>
          <button type="button" className="nomina-ghost-btn" onClick={() => setNovedadModal("new")}>Nueva Novedad</button>
          <button type="button" className="nomina-ghost-btn" onClick={handleSync}>Sincronizar Egresos</button>
          <div className="nomina-dark-btn nomina-status-chip">
            {workflow.ready_to_close ? "Listo para cierre" : "Cierre pendiente"}
          </div>
        </div>
      </div>

      <section className="nomina-section">
        <div className="nomina-mini-head">
          <div>
            <h3>Paso a Paso de la Nómina</h3>
            <p>{workflow.completed_steps || 0} de {workflow.total_steps || 0} pasos completos para {workflow.periodo || periodoNomina}.</p>
          </div>
          <span className="nomina-link-btn nomina-link-badge">{workflow.ready_to_close ? "Listo para cierre" : `Sigue: Paso ${nextStep?.stepNumber || 1}`}</span>
        </div>
        <div className="nomina-next-step">
          <div className="nomina-next-step-copy">
            <span>Siguiente paso recomendado</span>
            <strong>Paso {nextStep?.stepNumber || 1}: {nextStep?.title || "Continuar proceso"}</strong>
            <p>{nextStep?.short || "Completa la siguiente etapa para avanzar con el cierre."}</p>
          </div>
          <button
            type="button"
            className="nomina-next-step-btn"
            onClick={() => {
              if (nextStep?.key === "asistencia") setAsistenciaModal("new");
              else if (nextStep?.key === "novedades") setNovedadModal("new");
              else if (nextStep?.key === "integracion") handleSync();
              else if (nextStep?.key === "liquidacion") jumpToNominaSection("nomina-liquidacion");
              else if (nextStep?.key === "seg_social") jumpToNominaSection("nomina-seg-social");
            }}
          >
            {nextStep?.action || "Continuar"}
          </button>
        </div>
        <div className="nomina-workflow-grid">
          {workflowGuide.map((step) => (
            <div key={step.key} className={`nomina-workflow-card ${step.completed ? "done" : ""}`}>
              <div className="nomina-workflow-topline">
                <span className="nomina-workflow-step">Paso {step.stepNumber}</span>
                <span className={`nomina-workflow-state ${step.completed ? "done" : "pending"}`}>
                  {step.completed ? "Completado" : "Pendiente"}
                </span>
              </div>
              <strong>{step.title}</strong>
              <b>{step.count ?? 0}</b>
              <p>{step.short}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="nomina-bento">
        <div className="nomina-kpi violet">
          <span>Empleados Activos</span>
          <strong>{stats.empleados ?? 0}</strong>
          <p>{topEmpleado ? `${topEmpleado.empleado} lidera el periodo.` : "Sin empleados cargados."}</p>
        </div>
        <div className="nomina-kpi black">
          <span>Total Nómina</span>
          <strong>{money(stats.total_nomina)}</strong>
          <p>Proyectado mensual actual.</p>
        </div>
        <div className="nomina-kpi rose">
          <span>Novedades</span>
          <strong>{pendientes}</strong>
          <p>{money(stats.total_novedades_devengado)} en devengados manuales.</p>
        </div>
        <div className="nomina-kpi green">
          <span>Asistencia</span>
          <strong>{stats.dias_laborados ?? 0} días</strong>
          <p>{stats.registros_asistencia ?? 0} empleados con asistencia consolidada.</p>
        </div>
        <div className="nomina-kpi dark">
          <span>Nómina Integrada</span>
          <strong>{money(stats.total_nomina_integrada)}</strong>
          <p>{stats.empleados ? `${Math.round(((stats.total_nomina_integrada || 0) / Math.max(totalDesembolso, 1)) * 100)}% del desembolso directo.` : "Pendiente de consolidación."}</p>
        </div>
      </div>

      <section className="nomina-section" id="nomina-liquidacion">
        <div className="nomina-section-head">
          <h3>Empleados en Nómina</h3>
          <div className="nomina-tabset">
            <span className="nomina-tab-label active">Q1 & Q2</span>
            <span className="nomina-tab-label">Detalle individual próximamente</span>
          </div>
        </div>

        <div className="nomina-table-wrap">
          <table className="nomina-table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th className="center">Cédula</th>
                <th className="right">Valor Día</th>
                <th className="center">Días Q1/Q2</th>
                <th className="right">Neto Q1</th>
                <th className="right">Neto Q2</th>
                <th className="right">Deducciones</th>
                <th className="right">Total Mes</th>
              </tr>
            </thead>
            <tbody>
              {resumen.length ? resumen.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="nomina-employee">
                      <div className="nomina-avatar">{initials(row.empleado)}</div>
                      <div className="nomina-employee-text">
                        <strong>{row.empleado}</strong>
                        <span>{Number(row.total_mes || 0) >= Number(stats.total_nomina || 0) / Math.max(stats.empleados || 1, 1) ? "Carga alta del periodo" : "Empleado activo"}</span>
                      </div>
                    </div>
                  </td>
                  <td className="center mono">{row.cedula}</td>
                  <td className="right strong">{money(row.valor_dia)}</td>
                  <td className="center">
                    <span className={`nomina-days ${Number(row.q2_dias || 0) === 0 ? "alert" : ""}`}>
                      {row.q1_dias} / {row.q2_dias}
                    </span>
                  </td>
                  <td className="right">{money(row.q1_neto)}</td>
                  <td className="right">{money(row.q2_neto)}</td>
                  <td className="right danger">{money(row.total_deduccion)}</td>
                  <td className="right total">{money(row.total_mes)}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8} className="nomina-empty">Sin información de nómina para este período.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7}>Total Desembolso Mes</td>
                <td className="right">{money(totalDesembolso)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="nomina-section">
        <div className="nomina-section-head">
          <h3>Asistencia Consolidada</h3>
          <div className="nomina-tabset">
            <button type="button" className="active">Resumen</button>
            <button
              type="button"
              onClick={() => {
                if (!selectedAsistencia) {
                  alert("Selecciona un registro de asistencia para editar.");
                  return;
                }
                setAsistenciaModal("edit");
              }}
            >
              Editar día
            </button>
            <button type="button" onClick={handleDeleteAsistencia}>Eliminar día</button>
          </div>
        </div>
        <div className="nomina-table-wrap">
          <table className="nomina-table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th className="center">Cédula</th>
                <th className="center">Q1</th>
                <th className="center">Q2</th>
                <th className="center">Laborados</th>
                <th className="center">Incapacidad</th>
                <th className="center">Vacaciones</th>
                <th className="center">No fue</th>
              </tr>
            </thead>
            <tbody>
              {asistenciaResumen.length ? asistenciaResumen.map((row, idx) => {
                const matchedAsistencia = asistencia.find((item) => item.empleado === row.empleado) || null;
                const rowSelected = selectedAsistencia && selectedAsistencia.empleado === row.empleado;
                return (
                  <tr
                    key={`${row.empleado}-${idx}`}
                    className={rowSelected ? "row-selected-lite" : ""}
                    onClick={() => setSelectedAsistencia(matchedAsistencia)}
                  >
                    <td>
                      <div className="nomina-employee">
                        <div className="nomina-avatar">{initials(row.empleado)}</div>
                        <div className="nomina-employee-text">
                          <strong>{row.empleado}</strong>
                          <span>{row.dias_laborados} días marcados en el período</span>
                        </div>
                      </div>
                    </td>
                    <td className="center mono">{row.cedula}</td>
                    <td className="center">{row.q1_laborados}</td>
                    <td className="center">{row.q2_laborados}</td>
                    <td className="center strong">{row.dias_laborados}</td>
                    <td className="center">{row.dias_incapacidad}</td>
                    <td className="center">{row.dias_vacaciones}</td>
                    <td className="center danger">{row.dias_no_fue}</td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={8} className="nomina-empty">Sin asistencia consolidada para este período.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="nomina-bottom-grid">
        <section className="nomina-section" id="nomina-seg-social">
          <div className="nomina-mini-head">
            <div>
              <h3>Detalle de Seguridad Social</h3>
              <p>Cálculos causados con base en la información importada.</p>
            </div>
          </div>
          <div className="nomina-subtable-wrap">
            <table className="nomina-subtable">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th className="right">Aporte Empresa</th>
                  <th className="right">Aporte Empleado</th>
                </tr>
              </thead>
              <tbody>
                {socialGroups.length ? socialGroups.map((row) => (
                  <tr key={row.concepto}>
                    <td>{row.concepto}</td>
                    <td className="right green">{money(row.empresa)}</td>
                    <td className="right">{money(row.empleado)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={3} className="nomina-empty">Sin conceptos de seguridad social.</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td>Gran Total</td>
                  <td colSpan={2} className="right">{money(stats.total_seg_social)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <div className="nomina-side-stack">
          <section className="nomina-section">
            <div className="nomina-mini-head">
              <div>
                <h3>Novedades Pendientes</h3>
                <p>{novedades.length} registros visibles en el período.</p>
              </div>
              <span className="nomina-link-btn nomina-link-badge">{asistencia.length} días registrados</span>
            </div>
            <div className="nomina-activity-list">
              {novedades.length ? novedades.slice(0, 4).map((row) => (
                <div
                  key={row.id}
                  className={`nomina-activity ${String(row.naturaleza).toUpperCase() === "DEDUCCION" ? "danger" : ""} ${selectedNovedad?.id === row.id ? "active" : ""}`}
                  onClick={() => setSelectedNovedad(row)}
                >
                  <div className="nomina-activity-icon">{String(row.tipo_novedad || "N").slice(0, 1)}</div>
                  <div className="nomina-activity-copy">
                    <strong>{row.tipo_novedad || "Novedad"}: {row.empleado}</strong>
                    <p>{row.quincena} · {row.naturaleza} · {money(row.valor)}</p>
                  </div>
                  <span>{formatDateLabel(row.fecha)}</span>
                </div>
              )) : (
                <div className="nomina-activity-empty">No hay novedades manuales registradas.</div>
              )}
            </div>
            <div className="nomina-mini-actions">
              <button type="button" className="nomina-link-btn" onClick={() => {
                if (!selectedNovedad) {
                  alert("Selecciona una novedad para editar.");
                  return;
                }
                setNovedadModal("edit");
              }}>Editar</button>
              <button type="button" className="nomina-danger-link" onClick={handleDeleteNovedad}>Eliminar</button>
            </div>
          </section>

          <section className="nomina-shortcut">
            <div>
              <h4>Registro Diario</h4>
              <p>Carga asistencia, incapacidades, vacaciones y ausencias antes de sincronizar a egresos.</p>
              <button type="button" onClick={() => setAsistenciaModal("new")}>Registrar Día</button>
            </div>
              <div className="nomina-shortcut-mark">$</div>
          </section>
        </div>
      </div>

      {novedadModal === "new" && (
        <NovedadModal
          periodo={periodoNomina}
          data={null}
          onClose={() => setNovedadModal(null)}
          onSaved={reload}
          setError={setError}
          notify={notify}
        />
      )}
      {asistenciaModal === "new" && (
        <AsistenciaModal
          periodo={periodoNomina}
          data={null}
          onClose={() => setAsistenciaModal(null)}
          onSaved={reload}
          setError={setError}
          notify={notify}
        />
      )}
      {asistenciaModal === "edit" && selectedAsistencia && (
        <AsistenciaModal
          periodo={periodoNomina}
          data={selectedAsistencia}
          onClose={() => setAsistenciaModal(null)}
          onSaved={reload}
          setError={setError}
          notify={notify}
        />
      )}
      {novedadModal === "edit" && selectedNovedad && (
        <NovedadModal
          periodo={periodoNomina}
          data={selectedNovedad}
          onClose={() => setNovedadModal(null)}
          onSaved={reload}
          setError={setError}
          notify={notify}
        />
      )}
    </div>
  );
}

// ── Reportes ──────────────────────────────────────────────────────────────────

function ReportesView({ reporte, auditoria, year, month, setYear, setMonth, years, reload, setError, notify }) {
  const cierre = reporte?.cierre || {};
  const tiposResumen = Object.values((reporte?.egresos || []).reduce((acc, row) => {
    const key = row.tipo_gasto || "OTRO";
    if (!acc[key]) acc[key] = { tipo: key, cantidad: 0, total: 0 };
    acc[key].cantidad += 1;
    acc[key].total += Number(row.valor || 0);
    return acc;
  }, {}))
    .sort((a, b) => b.total - a.total)
    .map((item) => ({
      ...item,
      porcentaje: cierre.total_egresos ? `${((item.total / cierre.total_egresos) * 100).toFixed(1)}%` : "0.0%",
    }));

  async function downloadReport() {
    await downloadExcelFile(`/api/export/reportes?mes=${month}&ano=${year}`, `Reporte_${month}_${year}.xlsx`, setError, notify);
  }

  async function handleToggleCierre() {
    const action = cierre.cerrado ? "reabrir" : "cerrar";
    const observacion = window.prompt(
      cierre.cerrado
        ? "Motivo para reabrir el período:"
        : "Observación de cierre del período:",
      ""
    );
    if (observacion === null) return;
    try {
      await request(`/api/cierres/${action}`, {
        method: "POST",
        body: JSON.stringify({ mes: month, ano: year, observacion }),
      });
      notify(cierre.cerrado ? "Período reabierto" : "Período cerrado", "success");
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page-view">
      <Toolbar title="Reportes y Cierre">
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <TBtn tone={cierre.cerrado ? "red" : "blue"} onClick={handleToggleCierre}>
          {cierre.cerrado ? "Reabrir Mes" : "Cerrar Mes"}
        </TBtn>
        <TBtn tone="green" onClick={downloadReport}>Exportar Reporte</TBtn>
      </Toolbar>

      <div className="split-panels">
        <div className="panel">
          <h3 className="panel-title">Cierre Mensual Unificado</h3>
          <div className="summary-list">
            <div className="summary-row summary-strong"><span>Periodo</span><strong>{cierre.periodo || `${MONTH_NAMES[month - 1]} ${year}`}</strong></div>
            <div className="summary-row"><span>Estado</span><strong>{cierre.cerrado ? "Cerrado" : "Abierto"}</strong></div>
            <div className="summary-row summary-divider" />
            <div className="summary-row summary-green"><span>Ingresos</span><strong>{money(cierre.total_ingresos)}</strong></div>
            <div className="summary-row"><span>Egresos operativos</span><strong>{money(cierre.egresos_operativos)}</strong></div>
            <div className="summary-row"><span>Nómina empleados</span><strong>{money(cierre.egresos_nomina)}</strong></div>
            <div className="summary-row"><span>Seguridad social</span><strong>{money(cierre.egresos_seg_social)}</strong></div>
            <div className="summary-row"><span>Novedades deducción</span><strong>{money(cierre.novedades_deduccion)}</strong></div>
            <div className="summary-row summary-red"><span>Total egresos</span><strong>{money(cierre.total_egresos)}</strong></div>
            <div className="summary-row summary-divider" />
            <div className="summary-row"><span>Nómina integrada</span><strong>{money(cierre.nomina?.total_nomina_integrada)}</strong></div>
            <div className="summary-row"><span>Empleados</span><strong>{cierre.nomina?.empleados ?? 0}</strong></div>
            <div className="summary-row"><span>Novedades +</span><strong>{money(cierre.nomina?.total_novedades_devengado)}</strong></div>
            <div className="summary-row"><span>Novedades -</span><strong>{money(cierre.nomina?.total_novedades_deduccion)}</strong></div>
            <div className="summary-row summary-strong summary-result"><span>Resultado neto</span><strong>{money(cierre.resultado_neto)}</strong></div>
          </div>
        </div>

        <div className="panel">
          <h3 className="panel-title">Detalle por Naturaleza del gasto</h3>
          <DataTable
            columns={[
              { key: "tipo",       label: "Naturaleza" },
              { key: "cantidad",   label: "N° Registros" },
              { key: "total",      label: "Total", render: (v) => money(v) },
              { key: "porcentaje", label: "%" },
            ]}
            rows={tiposResumen}
          />
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="Ingresos" value={money(cierre.total_ingresos)} tone="green" />
        <StatCard label="Egresos" value={money(cierre.total_egresos)} tone="red" />
        <StatCard label="Resultado neto" value={money(cierre.resultado_neto)} tone="blue" />
        <StatCard label="Nómina integrada" value={money(cierre.nomina?.total_nomina_integrada)} tone="slate" />
      </div>

      <div className="split-panels">
        <div className="panel">
          <h3 className="panel-title">Detalle de Egresos</h3>
          <DataTable
            columns={[
              { key: "fecha",        label: "Fecha" },
              { key: "razon_social", label: "Proveedor" },
              { key: "tipo_gasto",   label: "Naturaleza" },
              { key: "valor",        label: "Valor", render: (v) => money(v) },
            ]}
            rows={reporte?.egresos || []}
          />
        </div>
        <div className="panel">
          <h3 className="panel-title">Detalle de Ingresos</h3>
          <DataTable
            columns={[
              { key: "fecha",      label: "Fecha" },
              { key: "caja",       label: "Caja", render: (v) => money(v) },
              { key: "bancos",     label: "Bancos", render: (v) => money(v) },
              { key: "tarjeta_cr", label: "Tarjeta CR", render: (v) => money(v) },
            ]}
            rows={reporte?.ingresos || []}
          />
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Auditoría Reciente</h3>
        <DataTable
          columns={[
            { key: "created_at", label: "Fecha" },
            { key: "entidad", label: "Entidad" },
            { key: "accion", label: "Acción" },
            { key: "periodo", label: "Período" },
            { key: "detalle", label: "Detalle" },
          ]}
          rows={auditoria || []}
          maxHeight="300px"
        />
      </div>
    </div>
  );
}

// ── App root ──────────────────────────────────────────────────────────────────

function App() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const [activeView, setActiveView] = useState("dashboard");
  const [year,  setYear]  = useState(currentYear);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [dashboard,    setDashboard]    = useState(null);
  const [systemSummary, setSystemSummary] = useState(EMPTY_SYSTEM_SUMMARY);
  const [proveedores,  setProveedores]  = useState([]);
  const [ingresos,     setIngresos]     = useState([]);
  const [egresos,      setEgresos]      = useState([]);
  const [nomina,       setNomina]       = useState(EMPTY_NOMINA);
  const [cierreMensual, setCierreMensual] = useState(null);
  const [reporte,      setReporte]      = useState(null);
  const [auditoria,    setAuditoria]    = useState([]);
  const [analisisIngresos, setAnalisisIngresos] = useState(null);
  const [periodoNomina, setPeriodoNomina] = useState("");
  const [authSession, setAuthSession] = useState(() => getStoredApiSession());
  const [authStatus, setAuthStatus] = useState({ requires_setup: false, users_count: 0, header: "Authorization", scheme: "Bearer" });
  const [authChecking, setAuthChecking] = useState(true);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [error,   setError]   = useState("");
  const [notice,  setNotice]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showRefreshingHint, setShowRefreshingHint] = useState(false);
  const loadedViewsRef = useRef({});
  const viewCacheRef = useRef({});
  const requestSeqRef = useRef(0);
  const dbHealthKnown = typeof systemSummary?.db_health?.ok === "boolean";
  const dbHealthy = systemSummary?.db_health?.ok !== false;

  const years = useMemo(
    () => Array.from({ length: 8 }, (_, i) => currentYear - 2 + i),
    [currentYear]
  );

  function notify(message, tone = "info") {
    setNotice({ message, tone });
  }

  const applyCachedViewState = useCallback((view, snapshot) => {
    if (!snapshot) return;
    if (snapshot.systemSummary) {
      setSystemSummary(snapshot.systemSummary);
    }
    switch (view) {
      case "dashboard":
        if ("dashboard" in snapshot) setDashboard(snapshot.dashboard);
        break;
      case "proveedores":
        if ("proveedores" in snapshot) setProveedores(snapshot.proveedores);
        break;
      case "ingresos":
        if ("ingresos" in snapshot) setIngresos(snapshot.ingresos);
        if ("cierreMensual" in snapshot) setCierreMensual(snapshot.cierreMensual);
        if ("analisisIngresos" in snapshot) setAnalisisIngresos(snapshot.analisisIngresos);
        break;
      case "egresos":
        if ("proveedores" in snapshot) setProveedores(snapshot.proveedores);
        if ("egresos" in snapshot) setEgresos(snapshot.egresos);
        if ("cierreMensual" in snapshot) setCierreMensual(snapshot.cierreMensual);
        break;
      case "nomina":
        if ("nomina" in snapshot) setNomina(snapshot.nomina);
        break;
      case "reportes":
        if ("reporte" in snapshot) setReporte(snapshot.reporte);
        if ("cierreMensual" in snapshot) setCierreMensual(snapshot.cierreMensual);
        if ("auditoria" in snapshot) setAuditoria(snapshot.auditoria);
        break;
      default:
        break;
    }
  }, []);

  const loadData = useCallback(async (view, { silent = false } = {}) => {
    const cacheKey = buildViewCacheKey(view, { month, year, periodoNomina });
    const requestId = ++requestSeqRef.current;
    if (!getStoredApiSession()?.token) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const loadTasks = [
        {
          label: "Sistema",
          promise: request("/api/system/summary"),
          fallback: EMPTY_SYSTEM_SUMMARY,
          apply: setSystemSummary,
          store: (value) => ({ systemSummary: value }),
        },
      ];

      switch (view) {
        case "dashboard":
          loadTasks.push({
            label: "Dashboard",
            promise: request(`/api/dashboard?mes=${month}&ano=${year}`),
            fallback: null,
            apply: setDashboard,
            store: (value) => ({ dashboard: value }),
          });
          break;
        case "proveedores":
          loadTasks.push({
            label: "Proveedores",
            promise: request("/api/proveedores"),
            fallback: [],
            apply: setProveedores,
            store: (value) => ({ proveedores: value }),
          });
          break;
        case "ingresos":
          loadTasks.push(
            {
              label: "Ingresos",
              promise: request(`/api/ingresos?mes=${month}&ano=${year}`),
              fallback: [],
              apply: setIngresos,
              store: (value) => ({ ingresos: value }),
            },
            {
              label: "Estado de cierre",
              promise: request(`/api/reportes/cierre?mes=${month}&ano=${year}&include_details=false`),
              fallback: null,
              apply: (value) => setCierreMensual(value?.cierre || null),
              store: (value) => ({ cierreMensual: value?.cierre || null }),
            },
            {
              label: "Análisis ingresos",
              promise: request("/api/ingresos/analisis"),
              fallback: null,
              apply: setAnalisisIngresos,
              store: (value) => ({ analisisIngresos: value }),
            }
          );
          break;
        case "egresos":
          loadTasks.push(
            {
              label: "Proveedores",
              promise: request("/api/proveedores"),
              fallback: [],
              apply: setProveedores,
              store: (value) => ({ proveedores: value }),
            },
            {
              label: "Egresos",
              promise: request(`/api/egresos?mes=${month}&ano=${year}`),
              fallback: [],
              apply: setEgresos,
              store: (value) => ({ egresos: value }),
            },
            {
              label: "Estado de cierre",
              promise: request(`/api/reportes/cierre?mes=${month}&ano=${year}&include_details=false`),
              fallback: null,
              apply: (value) => setCierreMensual(value?.cierre || null),
              store: (value) => ({ cierreMensual: value?.cierre || null }),
            }
          );
          break;
        case "nomina":
          loadTasks.push({
            label: "Nómina",
            promise: request(
              periodoNomina
                ? `/api/nomina?periodo=${encodeURIComponent(periodoNomina)}`
                : "/api/nomina"
            ),
            fallback: EMPTY_NOMINA,
            apply: (value) => {
              setNomina(value);
              if (!periodoNomina && value?.periodos?.length) {
                setPeriodoNomina((current) => current || value.periodos[0]);
              }
            },
            store: (value) => ({ nomina: value }),
          });
          break;
        case "reportes":
          loadTasks.push(
            {
              label: "Reportes",
              promise: request(`/api/reportes/cierre?mes=${month}&ano=${year}`),
              fallback: null,
              apply: (value) => {
                setReporte(value);
                setCierreMensual(value?.cierre || null);
              },
              store: (value) => ({
                reporte: value,
                cierreMensual: value?.cierre || null,
              }),
            },
            {
              label: "Auditoría",
              promise: request("/api/auditoria?limit=80"),
              fallback: [],
              apply: setAuditoria,
              store: (value) => ({ auditoria: value }),
            }
          );
          break;
        default:
          break;
      }

      const baseResults = await Promise.allSettled(loadTasks.map((task) => task.promise));
      const isLatestRequest = requestId === requestSeqRef.current;
      const failures = [];
      const snapshotPatch = {};
      baseResults.forEach((result, index) => {
        const task = loadTasks[index];
        if (result.status === "fulfilled" && task.store) {
          Object.assign(snapshotPatch, task.store(result.value));
        }
        applyLoadTask(task, result, failures, {
          preserveOnError: silent,
          applyToState: isLatestRequest,
        });
      });
      if (baseResults.some((result) => result.status === "fulfilled")) {
        viewCacheRef.current[cacheKey] = {
          ...(viewCacheRef.current[cacheKey] || {}),
          ...snapshotPatch,
        };
        loadedViewsRef.current[cacheKey] = true;
      }

      if (isLatestRequest && failures.length) {
        setError(failures.join(" | "));
      }
    } catch (err) {
      if (requestId === requestSeqRef.current) {
        setError(err.message);
      }
    } finally {
      if (requestId === requestSeqRef.current) {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    }
  }, [month, year, periodoNomina]);

  useEffect(() => {
    let cancelled = false;

    const syncAuthState = async () => {
      setAuthChecking(true);
      try {
        const status = await request("/api/auth/status");
        if (cancelled) return;
        setAuthStatus(status);

        const stored = getStoredApiSession();
        if (!stored?.token) {
          setAuthSession(null);
          return;
        }

        try {
          const session = await request("/api/auth/session");
          if (cancelled) return;
          const nextSession = persistApiSession({
            ...stored,
            header: session.header || stored.header,
            scheme: session.scheme || stored.scheme,
            expires_at: session.expires_at || stored.expires_at,
            user: session.user || stored.user,
          });
          setAuthSession(nextSession);
        } catch {
          resetApiSession();
          if (cancelled) return;
          setAuthSession(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) {
          setAuthChecking(false);
          setLoading(false);
        }
      }
    };

    syncAuthState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authSession?.token) return;
    const cacheKey = buildViewCacheKey(activeView, { month, year, periodoNomina });
    const cached = viewCacheRef.current[cacheKey];
    if (cached) {
      applyCachedViewState(activeView, cached);
    }
    const shouldRefresh = Object.keys(loadedViewsRef.current).length > 0 || Boolean(cached);
    loadData(activeView, { silent: shouldRefresh });
  }, [authSession?.token, activeView, month, year, periodoNomina, applyCachedViewState, loadData]);

  useEffect(() => {
    if (!refreshing) {
      setShowRefreshingHint(false);
      return;
    }
    const timer = window.setTimeout(() => setShowRefreshingHint(true), 180);
    return () => window.clearTimeout(timer);
  }, [refreshing]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const handleAuthInvalid = () => {
      loadedViewsRef.current = {};
      viewCacheRef.current = {};
      requestSeqRef.current += 1;
      setAuthSession(null);
      setActiveView("dashboard");
      setDashboard(null);
      setSystemSummary(EMPTY_SYSTEM_SUMMARY);
      setProveedores([]);
      setIngresos([]);
      setEgresos([]);
      setNomina(EMPTY_NOMINA);
      setCierreMensual(null);
      setReporte(null);
      setAuditoria([]);
      setAnalisisIngresos(null);
      setLoading(false);
      setRefreshing(false);
      setError("Tu sesión expiró o dejó de ser válida. Inicia sesión de nuevo.");
    };
    window.addEventListener(AUTH_INVALID_EVENT, handleAuthInvalid);
    return () => window.removeEventListener(AUTH_INVALID_EVENT, handleAuthInvalid);
  }, []);

  async function handleLogin(credentials) {
    setAuthSubmitting(true);
    setError("");
    try {
      loadedViewsRef.current = {};
      viewCacheRef.current = {};
      requestSeqRef.current += 1;
      const session = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      });
      const nextSession = persistApiSession(session);
      setAuthSession(nextSession);
      setAuthStatus((current) => ({
        ...(current || {}),
        requires_setup: false,
        users_count: Math.max(current?.users_count || 0, 1),
      }));
      notify("Sesión iniciada correctamente", "success");
    } catch (err) {
      setError(err.message);
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleBootstrap(payload) {
    setAuthSubmitting(true);
    setError("");
    try {
      loadedViewsRef.current = {};
      viewCacheRef.current = {};
      requestSeqRef.current += 1;
      const session = await request("/api/auth/bootstrap", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const nextSession = persistApiSession(session);
      setAuthSession(nextSession);
      setAuthStatus((current) => ({
        ...(current || {}),
        requires_setup: false,
        users_count: 1,
      }));
      notify("Administrador inicial creado correctamente", "success");
    } catch (err) {
      setError(err.message);
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      if (getStoredApiSession()?.token) {
        await request("/api/auth/logout", { method: "POST" });
      }
    } catch {
      // Si el token ya no es válido, igual cerramos sesión localmente.
    } finally {
      loadedViewsRef.current = {};
      viewCacheRef.current = {};
      requestSeqRef.current += 1;
      resetApiSession();
      setAuthSession(null);
      setActiveView("dashboard");
      setDashboard(null);
      setSystemSummary(EMPTY_SYSTEM_SUMMARY);
      setProveedores([]);
      setIngresos([]);
      setEgresos([]);
      setNomina(EMPTY_NOMINA);
      setCierreMensual(null);
      setReporte(null);
      setAuditoria([]);
      setAnalisisIngresos(null);
      setError("");
      setLoading(false);
      notify("Sesión cerrada", "success");
    }
  }

  if (authChecking) {
    return (
      <div className="auth-shell">
        <div className="loading-card">Verificando acceso...</div>
      </div>
    );
  }

  if (!authSession?.token) {
    return (
      <>
        <Toast notice={notice} onClose={() => setNotice(null)} />
        <AuthView
          requiresSetup={authStatus.requires_setup}
          pending={authSubmitting}
          error={error}
          onLogin={handleLogin}
          onBootstrap={handleBootstrap}
        />
      </>
    );
  }

  return (
    <div className="app-shell">
      <Toast notice={notice} onClose={() => setNotice(null)} />
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1>Contabilidad<br />Morsa</h1>
          <p>Control mensual de ingresos,<br />egresos y proveedores</p>
        </div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={`nav-link${activeView === item.key ? " active" : ""}`}
              onClick={() => setActiveView(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <strong className={`health-chip ${dbHealthy ? "ok" : "bad"}`}>
            {dbHealthy ? "Base estable" : "Base degradada"}
          </strong>
          <div className="sidebar-user">
            <strong>{authSession.user?.full_name || authSession.user?.username}</strong>
            <span>
              {authSession.user?.role === "admin" ? "Administrador" : authSession.user?.role || "Usuario"}
            </span>
          </div>
          <button type="button" className="sidebar-logout" onClick={handleLogout}>
            Cerrar sesión
          </button>
          <br />
          Supabase Postgres<br />FastAPI + React
          <br />
          Storage: {systemSummary?.storage_mode || "database"}
        </div>
      </aside>

      <main className="workspace">
        {showRefreshingHint && <div className="loading-inline">Actualizando datos...</div>}
        {!loading && dbHealthKnown && !dbHealthy && (
          <div className="system-banner system-banner-bad">
            La base de datos reporta estado degradado. Revisa el log en {systemSummary?.log_file || "logs"} y la conexión de PostgreSQL.
          </div>
        )}
        {error && (
          <div className="error-banner">
            {error}
            <button className="error-close" onClick={() => setError("")}>✕</button>
          </div>
        )}
        {loading && <div className="loading-card">Cargando datos...</div>}

        {!loading && activeView === "dashboard" && (
          <DashboardView
            year={year} month={month} setYear={setYear} setMonth={setMonth}
            years={years} navigate={setActiveView} dashboard={dashboard}
          />
        )}
        {!loading && activeView === "caja" && (
          <CajaView
            reload={() => loadData("caja", { silent: true })}
            setError={setError}
            notify={notify}
          />
        )}
        {!loading && activeView === "proveedores" && (
          <ProveedoresView proveedores={proveedores} reload={() => loadData("proveedores", { silent: true })} setError={setError} notify={notify} />
        )}
        {!loading && activeView === "ingresos" && (
          <IngresosView
            ingresos={ingresos} year={year} month={month}
            setYear={setYear} setMonth={setMonth} years={years}
            periodClosed={!!cierreMensual?.cerrado}
            analisis={analisisIngresos}
            reload={() => loadData("ingresos", { silent: true })} setError={setError} notify={notify}
          />
        )}
        {!loading && activeView === "egresos" && (
          <EgresosView
            egresos={egresos} proveedores={proveedores} year={year} month={month}
            setYear={setYear} setMonth={setMonth} years={years}
            periodClosed={!!cierreMensual?.cerrado}
            reload={() => loadData("egresos", { silent: true })} setError={setError} notify={notify}
          />
        )}
        {!loading && activeView === "nomina" && (
          <NominaView
            nomina={nomina} periodoNomina={periodoNomina}
            setPeriodoNomina={setPeriodoNomina}
            reload={() => loadData("nomina", { silent: true })}
            setError={setError}
            notify={notify}
          />
        )}
        {!loading && activeView === "reportes" && (
          <ReportesView
            reporte={reporte} year={year} month={month}
            setYear={setYear} setMonth={setMonth} years={years}
            auditoria={auditoria}
            reload={() => loadData("reportes", { silent: true })}
            setError={setError} notify={notify}
          />
        )}
      </main>
    </div>
  );
}

export default App;
