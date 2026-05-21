import { useEffect, useRef, useState } from "react";
import { request } from "../lib/api";

// ─── Borrador local (localStorage) ───────────────────────────────────────────

function _draftKey(fecha, turno) {
  return `morsa_inv_draft_${fecha}_t${turno}`;
}

function guardarBorrador(fecha, turno, registro, extras, observaciones) {
  try {
    localStorage.setItem(_draftKey(fecha, turno), JSON.stringify({
      registro, extras, observaciones, ts: Date.now(),
    }));
  } catch { /* storage lleno o bloqueado */ }
}

function cargarBorrador(fecha, turno) {
  try {
    const raw = localStorage.getItem(_draftKey(fecha, turno));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function borrarBorrador(fecha, turno) {
  try { localStorage.removeItem(_draftKey(fecha, turno)); } catch {}
}

function formatHora(date) {
  return date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function InventarioMobileView({ session, setError, notify, onLogout }) {
  const today = new Date().toLocaleDateString("en-CA");
  const [fecha, setFecha] = useState(today);
  const [turno, setTurno] = useState(1);
  const [turnosDelDia, setTurnosDelDia] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [registro, setRegistro] = useState({});
  const [extras, setExtras] = useState([]);
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [cargandoRegistro, setCargandoRegistro] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [modificados, setModificados] = useState(new Set());
  const [extrasDirty, setExtrasDirty] = useState(false);
  const [obsDirty, setObsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [borradorLocal, setBorradorLocal] = useState(null);

  const hayPendientes = modificados.size > 0 || extrasDirty || obsDirty;

  // Ref para auto-save: siempre apunta a la versión más reciente de guardar
  const guardarRef = useRef(null);

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    setModificados(new Set());
    setExtrasDirty(false);
    setObsDirty(false);
    cargarInsumos();
    cargarTurnos();
  }, [fecha]);

  useEffect(() => {
    setModificados(new Set());
    setExtrasDirty(false);
    setObsDirty(false);
    setExtras([]);
    setObservaciones("");
    cargarRegistro();
  }, [fecha, turno]);

  // Protección 1 — Borrador local: guarda en localStorage en cada cambio pendiente
  useEffect(() => {
    if (!hayPendientes) return;
    guardarBorrador(fecha, turno, registro, extras, observaciones);
  }, [registro, extras, observaciones, hayPendientes]);

  // Protección 2 — Advertencia al cerrar/salir de la pestaña con cambios sin guardar
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (!hayPendientes) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hayPendientes]);

  // Protección 3 — Auto-guardado al servidor cada 2 minutos si hay cambios
  useEffect(() => {
    if (!hayPendientes) return;
    const id = setInterval(() => {
      guardarRef.current?.({ silencioso: true });
    }, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, [hayPendientes]);

  // ── Carga de datos ─────────────────────────────────────────────────────────

  async function cargarInsumos() {
    try {
      setCargando(true);
      const data = await request("/api/insumos");
      setInsumos(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  async function cargarTurnos() {
    try {
      const data = await request(`/api/inventario/turnos?fecha=${fecha}`);
      setTurnosDelDia(data);
      if (data.length > 0) {
        setTurno(data[data.length - 1].turno);
      } else {
        setTurno(1);
      }
    } catch {
      setTurnosDelDia([]);
      setTurno(1);
    }
  }

  async function cargarRegistro() {
    try {
      setCargandoRegistro(true);
      const data = await request(`/api/inventario?fecha=${fecha}&turno=${turno}`);
      const reg = {};
      const loadedExtras = [];
      let serverTs = 0;
      data.forEach((item) => {
        if (item.insumo_id !== null && item.insumo_id !== undefined) {
          reg[item.insumo_id] = item;
        } else if (item.nombre_extra) {
          loadedExtras.push({ nombre: item.nombre_extra, notas: item.notas || "" });
        }
        if (item.created_at) {
          const t = new Date(item.created_at).getTime();
          if (t > serverTs) serverTs = t;
        }
      });
      setRegistro(reg);
      setExtras(loadedExtras);

      // Ofrecer restaurar borrador si es más reciente que lo que hay en el servidor
      const draft = cargarBorrador(fecha, turno);
      setBorradorLocal(draft && draft.ts > serverTs ? draft : null);
    } catch (err) {
      setError(err.message);
      setRegistro({});
      // Si el servidor falló, ofrecer igualmente el borrador local
      const draft = cargarBorrador(fecha, turno);
      if (draft) setBorradorLocal(draft);
    } finally {
      setCargandoRegistro(false);
    }
  }

  // ── Acciones ───────────────────────────────────────────────────────────────

  // Protección 4 — Confirmar antes de cambiar fecha/turno si hay cambios sin guardar
  function confirmarSiHayPendientes(mensaje) {
    if (!hayPendientes) return true;
    return window.confirm(`${mensaje}\n\n¿Continuar sin guardar?`);
  }

  function cambiarFecha(nuevaFecha) {
    if (!confirmarSiHayPendientes("Hay cambios sin guardar en este turno.")) return;
    setFecha(nuevaFecha);
  }

  function cambiarTurno(nuevoTurno) {
    if (!confirmarSiHayPendientes("Hay cambios sin guardar en este turno.")) return;
    setTurno(nuevoTurno);
  }

  function iniciarNuevoTurno() {
    if (!confirmarSiHayPendientes("Hay cambios sin guardar en este turno.")) return;
    const proximo = turnosDelDia.length > 0
      ? Math.max(...turnosDelDia.map((t) => t.turno)) + 1
      : 1;
    setTurno(proximo);
    setRegistro({});
    setExtras([]);
    setObservaciones("");
    setModificados(new Set());
    setExtrasDirty(false);
    setObsDirty(false);
  }

  function restaurarBorrador(draft) {
    setRegistro(draft.registro || {});
    setExtras(draft.extras || []);
    setObservaciones(draft.observaciones || "");
    const ids = Object.keys(draft.registro || {}).map(Number).filter((n) => !isNaN(n));
    setModificados(new Set(ids));
    setExtrasDirty((draft.extras || []).length > 0);
    setObsDirty(!!(draft.observaciones || "").trim());
    setBorradorLocal(null);
  }

  function descartarBorrador() {
    borrarBorrador(fecha, turno);
    setBorradorLocal(null);
  }

  function agregarExtra() {
    setExtras((cur) => [...cur, { nombre: "", notas: "" }]);
    setExtrasDirty(true);
  }

  function actualizarExtra(idx, campo, valor) {
    setExtras((cur) => cur.map((e, i) => i === idx ? { ...e, [campo]: valor } : e));
    setExtrasDirty(true);
  }

  function eliminarExtra(idx) {
    setExtras((cur) => cur.filter((_, i) => i !== idx));
    setExtrasDirty(true);
  }

  async function guardar({ silencioso = false } = {}) {
    try {
      setGuardando(true);
      if (cargando || cargandoRegistro) {
        setError("Espera a que termine de cargar el inventario antes de guardar.");
        setGuardando(false);
        return;
      }
      const idsConRegistroPrevio = new Set(Object.keys(registro).map(Number));
      const items = insumos
        .filter((ins) => modificados.has(ins.id) || idsConRegistroPrevio.has(ins.id))
        .map((ins) => {
          const item = registro[ins.id] || { estado: "hay" };
          return {
            insumo_id: ins.id,
            estado: item.estado || "hay",
            cantidad: item.cantidad || null,
            notas: item.notas || null,
          };
        });

      const extrasValidos = extras
        .filter((e) => e.nombre.trim())
        .map((e) => ({
          insumo_id: null,
          nombre_extra: e.nombre.trim(),
          estado: "traer",
          cantidad: null,
          notas: e.notas || null,
        }));

      const totalItems = items.length + extrasValidos.length;
      if (totalItems === 0) {
        setError("No hay elementos para guardar. Marca al menos un insumo antes de guardar.");
        setGuardando(false);
        return;
      }

      await request("/api/inventario", {
        method: "POST",
        body: JSON.stringify({
          fecha,
          turno,
          items: [...items, ...extrasValidos],
          observaciones: observaciones.trim() || null,
        }),
      });

      // Éxito — limpiar estado pendiente y borrador local
      setModificados(new Set());
      setExtrasDirty(false);
      setObsDirty(false);
      setLastSavedAt(new Date());
      borrarBorrador(fecha, turno);

      if (!silencioso) notify(`Turno ${turno} guardado correctamente`, "success");
      await cargarTurnos();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  // Actualizar ref en cada render para que el auto-save use el guardar más reciente
  guardarRef.current = guardar;

  // ── Helpers de presentación ───────────────────────────────────────────────

  function formatFechaDisplay(fechaStr) {
    const [year, month, day] = fechaStr.split("-");
    const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
    return `${parseInt(day)} de ${meses[parseInt(month) - 1]} de ${year}`;
  }

  const filtrados = insumos.filter((ins) =>
    ins.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const byCategoria = {};
  filtrados.forEach((ins) => {
    const cat = ins.categoria || "General";
    if (!byCategoria[cat]) byCategoria[cat] = [];
    byCategoria[cat].push(ins);
  });

  const totalItems = insumos.length;
  const itemsTraer = insumos.filter((ins) => registro[ins.id]?.estado === "traer").length;
  const itemsHay = insumos.filter((ins) => !registro[ins.id] || registro[ins.id]?.estado === "hay").length;
  const esNuevoTurno = !turnosDelDia.some((t) => t.turno === turno);

  if (cargando) {
    return (
      <div className="inv-loading">
        <div className="inv-loading-inner">Cargando inventario...</div>
      </div>
    );
  }

  return (
    <div className="inv-root">
      {/* Header */}
      <div className="inv-header">
        <div className="inv-header-top">
          <div className="inv-logo">📋</div>
          <div className="inv-header-info">
            <h1 className="inv-title">Control de Inventario</h1>
            <p className="inv-subtitle">Turno diario de cocina</p>
          </div>
          {/* Protección 5 — Indicador visible de cambios sin guardar */}
          {hayPendientes && (
            <span className="inv-pendientes-badge">● Sin guardar</span>
          )}
          {onLogout && (
            <button className="inv-logout-btn" onClick={onLogout} title="Cerrar sesión">
              Salir
            </button>
          )}
        </div>

        {/* Protección 1b — Banner de borrador local disponible */}
        {borradorLocal && (
          <div className="inv-borrador-banner">
            <span>Borrador del {new Date(borradorLocal.ts).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })} — no se guardó al servidor.</span>
            <div className="inv-borrador-actions">
              <button className="inv-borrador-btn inv-borrador-restore" onClick={() => restaurarBorrador(borradorLocal)}>Restaurar</button>
              <button className="inv-borrador-btn inv-borrador-discard" onClick={descartarBorrador}>Descartar</button>
            </div>
          </div>
        )}

        <div className="inv-fecha-row">
          <span className="inv-fecha-label">Fecha:</span>
          <label className="inv-fecha-display" htmlFor="inv-fecha-input">
            {formatFechaDisplay(fecha)}
          </label>
          <input
            id="inv-fecha-input"
            type="date"
            value={fecha}
            onChange={(e) => cambiarFecha(e.target.value)}
            className="inv-fecha-input"
          />
        </div>

        {/* Selector de turno */}
        <div className="inv-turno-row">
          <div className="inv-turno-tabs">
            {turnosDelDia.map((t) => (
              <button
                key={t.turno}
                className={`inv-turno-tab ${turno === t.turno && !esNuevoTurno ? "inv-turno-tab-activo" : ""}`}
                onClick={() => cambiarTurno(t.turno)}
              >
                Turno {t.turno}
                {t.items_traer > 0 && (
                  <span className="inv-turno-badge">{t.items_traer}</span>
                )}
              </button>
            ))}
            {esNuevoTurno && (
              <button className="inv-turno-tab inv-turno-tab-activo inv-turno-tab-nuevo">
                Turno {turno} ✦
              </button>
            )}
          </div>
          <button className="inv-turno-nuevo-btn" onClick={iniciarNuevoTurno}>
            + Nuevo turno
          </button>
        </div>

        <div className="inv-stats-row">
          <div className="inv-stat inv-stat-total">
            <strong>{totalItems}</strong>
            <span>Total</span>
          </div>
          <div className="inv-stat inv-stat-hay">
            <strong>{itemsHay}</strong>
            <span>Hay</span>
          </div>
          <div className="inv-stat inv-stat-traer">
            <strong>{itemsTraer}</strong>
            <span>Traer</span>
          </div>
        </div>
      </div>

      {/* Búsqueda */}
      <div className="inv-busqueda-wrap">
        <span className="inv-busqueda-icon">🔍</span>
        <input
          type="text"
          placeholder="Buscar insumo..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="inv-busqueda"
        />
      </div>

      {/* Lista por categoría */}
      <div className="inv-body">
        {Object.entries(byCategoria).map(([categoria, items]) => (
          <div key={categoria} className="inv-categoria-bloque">
            <div className="inv-categoria-header">
              <span className="inv-categoria-nombre">{categoria}</span>
              <span className="inv-categoria-count">{items.length}</span>
            </div>

            <div className="inv-tabla">
              <div className="inv-tabla-head">
                <div className="inv-col-nombre">Ingrediente</div>
                <div className="inv-col-existencia">Existencia</div>
              </div>

              {items.map((ins, idx) => {
                const item = registro[ins.id] || { estado: "hay" };
                const esHay = item.estado === "hay";
                return (
                  <div
                    key={ins.id}
                    className={`inv-fila ${!esHay ? "inv-fila-traer" : ""} ${idx % 2 === 0 ? "inv-fila-par" : ""}`}
                  >
                    <div className="inv-col-nombre">
                      <span className="inv-insumo-nombre">{ins.nombre}</span>
                    </div>

                    <div className="inv-col-existencia">
                      <div className="inv-toggles">
                        <button
                          className={`inv-btn-hay ${esHay ? "inv-btn-hay-activo" : ""}`}
                          onClick={() => {
                            setModificados((m) => new Set([...m, ins.id]));
                            setRegistro((cur) => ({
                              ...cur,
                              [ins.id]: { ...item, estado: "hay", cantidad: null },
                            }));
                          }}
                        >
                          HAY
                        </button>
                        <button
                          className={`inv-btn-traer ${!esHay ? "inv-btn-traer-activo" : ""}`}
                          onClick={() => {
                            setModificados((m) => new Set([...m, ins.id]));
                            setRegistro((cur) => ({
                              ...cur,
                              [ins.id]: { ...item, estado: "traer" },
                            }));
                          }}
                        >
                          TRAER
                        </button>
                      </div>

                      {!esHay && (
                        <input
                          type="text"
                          placeholder="¿Cuánto? Ej: 1 bolsa, 2 latas..."
                          value={item.notas || ""}
                          onChange={(e) => {
                            setModificados((m) => new Set([...m, ins.id]));
                            setRegistro((cur) => ({
                              ...cur,
                              [ins.id]: { ...item, notas: e.target.value },
                            }));
                          }}
                          className="inv-notas-input"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Productos extra */}
      <div className="inv-extras-bloque">
        <div className="inv-extras-header">
          <div>
            <span className="inv-extras-titulo">Productos extra</span>
            <span className="inv-extras-sub">Items fuera de la lista habitual</span>
          </div>
          <button className="inv-extras-add-btn" onClick={agregarExtra}>
            + Agregar
          </button>
        </div>

        {extras.length === 0 && (
          <div className="inv-extras-empty">
            Sin productos extra por ahora
          </div>
        )}

        {extras.map((extra, idx) => (
          <div key={idx} className="inv-extra-fila">
            <div className="inv-extra-inputs">
              <input
                type="text"
                placeholder="Nombre del producto *"
                value={extra.nombre}
                onChange={(e) => actualizarExtra(idx, "nombre", e.target.value)}
                className="inv-extra-nombre"
              />
              <input
                type="text"
                placeholder="Cantidad o descripción"
                value={extra.notas}
                onChange={(e) => actualizarExtra(idx, "notas", e.target.value)}
                className="inv-extra-notas"
              />
            </div>
            <button className="inv-extra-del" onClick={() => eliminarExtra(idx)}>✕</button>
          </div>
        ))}
      </div>

      {/* Observaciones */}
      <div className="inv-obs-bloque">
        <div className="inv-obs-header">
          <span className="inv-obs-titulo">Observaciones del turno</span>
          <span className="inv-obs-sub">Notas generales, incidentes, recordatorios</span>
        </div>
        <textarea
          className="inv-obs-textarea"
          placeholder="Ej: La nevera está haciendo ruido, falta limpiar el extractor, llegó pedido incompleto..."
          value={observaciones}
          onChange={(e) => {
            setObservaciones(e.target.value);
            setObsDirty(true);
          }}
          rows={3}
        />
      </div>

      {/* Botón guardar + Protección 6 — timestamp del último guardado */}
      <div className="inv-footer">
        <button className="inv-btn-guardar" onClick={() => guardar()} disabled={guardando || cargandoRegistro}>
          {guardando ? "Guardando..." : cargandoRegistro ? "Cargando datos..." : `✓ Guardar Turno ${turno} — ${formatFechaDisplay(fecha)}`}
        </button>
        {lastSavedAt && !hayPendientes && (
          <p className="inv-last-saved">Guardado a las {formatHora(lastSavedAt)}</p>
        )}
      </div>
    </div>
  );
}
