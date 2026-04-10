import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  applyLoadTask,
  AUTH_INVALID_EVENT,
  getStoredApiSession,
  persistApiSession,
  request,
  resetApiSession,
} from "./lib/api";
import {
  EMPTY_NOMINA,
  EMPTY_SYSTEM_SUMMARY,
  NAV_ITEMS,
} from "./lib/constants";
import { AuthView, Toast } from "./components/ui";
import { CajaView } from "./views/CajaView";
import { DashboardView } from "./views/DashboardView";
import { EgresosView } from "./views/EgresosView";
import { IngresosView } from "./views/IngresosView";
import { NominaView } from "./views/NominaView";
import { ProveedoresView } from "./views/ProveedoresView";
import { ReportesView } from "./views/ReportesView";

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
