import { useEffect, useState } from "react";
import { request } from "../lib/api";

export function InventarioMobileView({ session, setError, notify }) {
  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD en hora local
  const [fecha, setFecha] = useState(today);
  const [turno, setTurno] = useState(1);
  const [turnosDelDia, setTurnosDelDia] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [registro, setRegistro] = useState({});
  const [extras, setExtras] = useState([]);
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [modificados, setModificados] = useState(new Set());

  useEffect(() => {
    setModificados(new Set());
    cargarInsumos();
    cargarTurnos();
  }, [fecha]);

  useEffect(() => {
    setModificados(new Set());
    setExtras([]);
    setObservaciones("");
    cargarRegistro();
  }, [fecha, turno]);

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
      // Si hay turnos existentes, cargar el último; si no, empezar en 1
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
      const data = await request(`/api/inventario?fecha=${fecha}&turno=${turno}`);
      const reg = {};
      data.forEach((item) => {
        reg[item.insumo_id] = item;
      });
      setRegistro(reg);
    } catch {
      setRegistro({});
    }
  }

  function iniciarNuevoTurno() {
    const proximo = turnosDelDia.length > 0
      ? Math.max(...turnosDelDia.map((t) => t.turno)) + 1
      : 1;
    setTurno(proximo);
    setRegistro({});
    setExtras([]);
    setObservaciones("");
    setModificados(new Set());
  }

  function agregarExtra() {
    setExtras((cur) => [...cur, { nombre: "", notas: "" }]);
  }

  function actualizarExtra(idx, campo, valor) {
    setExtras((cur) => cur.map((e, i) => i === idx ? { ...e, [campo]: valor } : e));
  }

  function eliminarExtra(idx) {
    setExtras((cur) => cur.filter((_, i) => i !== idx));
  }

  async function guardar() {
    try {
      setGuardando(true);
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

      await request("/api/inventario", {
        method: "POST",
        body: JSON.stringify({
          fecha,
          turno,
          items: [...items, ...extrasValidos],
          observaciones: observaciones.trim() || null,
        }),
      });
      notify(`Turno ${turno} guardado correctamente`, "success");
      // Actualizar lista de turnos
      await cargarTurnos();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

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
      {/* Header tipo formulario */}
      <div className="inv-header">
        <div className="inv-header-top">
          <div className="inv-logo">📋</div>
          <div className="inv-header-info">
            <h1 className="inv-title">Control de Inventario</h1>
            <p className="inv-subtitle">Turno diario de cocina</p>
          </div>
        </div>
        <div className="inv-fecha-row">
          <span className="inv-fecha-label">Fecha:</span>
          <label className="inv-fecha-display" htmlFor="inv-fecha-input">
            {formatFechaDisplay(fecha)}
          </label>
          <input
            id="inv-fecha-input"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
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
                onClick={() => setTurno(t.turno)}
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
          onChange={(e) => setObservaciones(e.target.value)}
          rows={3}
        />
      </div>

      {/* Botón guardar */}
      <div className="inv-footer">
        <button className="inv-btn-guardar" onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando..." : `✓ Guardar Turno ${turno} — ${formatFechaDisplay(fecha)}`}
        </button>
      </div>
    </div>
  );
}
