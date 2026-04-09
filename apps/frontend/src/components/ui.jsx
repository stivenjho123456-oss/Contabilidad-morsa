import { useState } from "react";

export function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-x" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function AuthView({ requiresSetup, pending, error, onLogin, onBootstrap }) {
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

export function Toast({ notice, onClose }) {
  if (!notice) return null;
  return (
    <div className={`toast toast-${notice.tone || "info"}`}>
      <span>{notice.message}</span>
      <button type="button" onClick={onClose}>✕</button>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function DataTable({ columns, rows, selectedId, onSelect, maxHeight = "420px" }) {
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

export function StatCard({ label, value, tone }) {
  return (
    <div className={`stat-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function MetricStrip({ items }) {
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

export function Toolbar({ title, subtitle, children }) {
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

export function TBtn({ tone = "navy", ...props }) {
  return <button className={`tbtn tbtn-${tone}`} {...props} />;
}
