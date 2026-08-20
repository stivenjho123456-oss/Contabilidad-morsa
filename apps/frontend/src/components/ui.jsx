import { useEffect, useState } from "react";
import { request } from "../lib/api";

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
  const [recuperando, setRecuperando] = useState(false);
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

  if (recuperando) {
    return <RecuperarPasswordView onVolver={() => setRecuperando(false)} />;
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
              <button
                type="button"
                className="auth-link"
                onClick={() => setRecuperando(true)}
              >
                ¿Olvidaste tu contraseña?
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}


export function RecuperarPasswordView({ onVolver }) {
  // paso 1: pedir usuario -> paso 2: responder preguntas y poner clave nueva -> paso 3: listo
  const [paso, setPaso] = useState(1);
  const [username, setUsername] = useState("");
  const [preguntas, setPreguntas] = useState([]);
  const [respuestas, setRespuestas] = useState({});
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function buscarPreguntas(event) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const data = await request("/api/auth/recuperar/preguntas", {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      setPreguntas(data.preguntas);
      setRespuestas({});
      setPaso(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  async function enviarRespuestas(event) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      await request("/api/auth/recuperar", {
        method: "POST",
        body: JSON.stringify({
          username,
          respuestas: preguntas.map((p) => ({
            orden: p.orden,
            respuesta: respuestas[p.orden] || "",
          })),
          password,
          password_confirm: passwordConfirm,
        }),
      });
      setPaso(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <section className="auth-side">
          <span className="auth-badge">Recuperar Acceso</span>
          <h1>Contabilidad Morsa</h1>
          <p>
            Responde tus preguntas de seguridad para volver a entrar. No necesitas
            correo ni ayuda de nadie.
          </p>
          <div className="auth-side-list">
            <div>Las respuestas no distinguen mayúsculas ni tildes</div>
            <div>Debes acertar todas las preguntas</div>
            <div>Al recuperar, se cierran tus sesiones abiertas</div>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-panel-head">
            <h2>
              {paso === 1 && "¿Cuál es tu usuario?"}
              {paso === 2 && "Responde tus preguntas"}
              {paso === 3 && "Listo"}
            </h2>
            <p>
              {paso === 1 && "Escribe tu usuario para traer tus preguntas de seguridad."}
              {paso === 2 && "Responde todas y define tu contraseña nueva."}
              {paso === 3 && "Tu contraseña quedó actualizada."}
            </p>
          </div>

          {error && <div className="auth-error">{error}</div>}

          {paso === 1 && (
            <form className="auth-form" onSubmit={buscarPreguntas}>
              <label className="auth-field">
                <span>Usuario</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Tu usuario"
                  autoComplete="username"
                  required
                />
              </label>
              <button className="auth-submit" type="submit" disabled={pending}>
                {pending ? "Buscando..." : "Continuar"}
              </button>
              <button type="button" className="auth-link" onClick={onVolver}>
                Volver a iniciar sesión
              </button>
            </form>
          )}

          {paso === 2 && (
            <form className="auth-form" onSubmit={enviarRespuestas}>
              {preguntas.map((p) => (
                <label className="auth-field" key={p.orden}>
                  <span>{p.pregunta}</span>
                  <input
                    value={respuestas[p.orden] || ""}
                    onChange={(event) =>
                      setRespuestas((current) => ({ ...current, [p.orden]: event.target.value }))
                    }
                    placeholder="Tu respuesta"
                    autoComplete="off"
                    required
                  />
                </label>
              ))}
              <label className="auth-field">
                <span>Contraseña nueva</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Mínimo 10 caracteres"
                  autoComplete="new-password"
                  required
                />
              </label>
              <label className="auth-field">
                <span>Confirmar contraseña</span>
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                  placeholder="Repite la contraseña"
                  autoComplete="new-password"
                  required
                />
              </label>
              <div className="auth-note">
                La contraseña debe incluir mínimo 10 caracteres, mayúscula, minúscula y número.
              </div>
              <button className="auth-submit" type="submit" disabled={pending}>
                {pending ? "Verificando..." : "Recuperar mi cuenta"}
              </button>
              <button type="button" className="auth-link" onClick={onVolver}>
                Cancelar
              </button>
            </form>
          )}

          {paso === 3 && (
            <div className="auth-form">
              <div className="auth-note">
                Ya puedes iniciar sesión con tu contraseña nueva. Las sesiones que
                tenías abiertas en otros dispositivos se cerraron.
              </div>
              <button className="auth-submit" type="button" onClick={onVolver}>
                Iniciar sesión
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}


export function PreguntasSeguridadModal({ onClose, notify }) {
  const [sugeridas, setSugeridas] = useState([]);
  const [minimo, setMinimo] = useState(3);
  const [yaConfiguradas, setYaConfiguradas] = useState([]);
  const [filas, setFilas] = useState([]);
  const [passwordActual, setPasswordActual] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vigente = true;
    request("/api/auth/preguntas")
      .then((data) => {
        if (!vigente) return;
        setSugeridas(data.sugeridas);
        setMinimo(data.minimo);
        setYaConfiguradas(data.configuradas);
        setFilas(
          Array.from({ length: data.minimo }, (_, i) => ({
            pregunta: data.sugeridas[i] || "",
            respuesta: "",
          })),
        );
      })
      .catch((err) => {
        if (vigente) setError(err.message);
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, []);

  async function guardar(event) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      await request("/api/auth/preguntas", {
        method: "POST",
        body: JSON.stringify({ password_actual: passwordActual, preguntas: filas }),
      });
      notify("Preguntas de recuperación guardadas.", "success");
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  function actualizarFila(indice, campo, valor) {
    setFilas((current) =>
      current.map((fila, i) => (i === indice ? { ...fila, [campo]: valor } : fila)),
    );
  }

  return (
    <Modal title="Preguntas de recuperación" onClose={onClose}>
      {cargando ? (
        <p>Cargando...</p>
      ) : (
        <form className="auth-form" onSubmit={guardar}>
          <div className="auth-note">
            {yaConfiguradas.length > 0
              ? `Ya tienes ${yaConfiguradas.length} preguntas configuradas. Si guardas, se reemplazan por las nuevas.`
              : `Configura ${minimo} preguntas. Si olvidas tu contraseña, responderlas te devuelve el acceso sin depender de nadie.`}
          </div>

          {filas.map((fila, indice) => (
            <div key={indice}>
              <label className="auth-field">
                <span>Pregunta {indice + 1}</span>
                <input
                  list={`preguntas-sugeridas-${indice}`}
                  value={fila.pregunta}
                  onChange={(event) => actualizarFila(indice, "pregunta", event.target.value)}
                  placeholder="Elige una o escribe la tuya"
                  required
                />
                <datalist id={`preguntas-sugeridas-${indice}`}>
                  {sugeridas.map((sugerida) => (
                    <option key={sugerida} value={sugerida} />
                  ))}
                </datalist>
              </label>
              <label className="auth-field">
                <span>Respuesta {indice + 1}</span>
                <input
                  value={fila.respuesta}
                  onChange={(event) => actualizarFila(indice, "respuesta", event.target.value)}
                  placeholder="Tu respuesta"
                  autoComplete="off"
                  required
                />
              </label>
            </div>
          ))}

          <div className="auth-note">
            No importan mayúsculas ni tildes. Elige respuestas que no cambien con el
            tiempo y que nadie más pueda adivinar.
          </div>

          <label className="auth-field">
            <span>Tu contraseña actual</span>
            <input
              type="password"
              value={passwordActual}
              onChange={(event) => setPasswordActual(event.target.value)}
              placeholder="Para confirmar que eres tú"
              autoComplete="current-password"
              required
            />
          </label>

          {error && <div className="auth-error">{error}</div>}

          <button className="auth-submit" type="submit" disabled={pending}>
            {pending ? "Guardando..." : "Guardar preguntas"}
          </button>
        </form>
      )}
    </Modal>
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
