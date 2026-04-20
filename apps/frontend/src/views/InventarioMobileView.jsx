import { useEffect, useState } from "react";
import { request } from "../lib/api";

export function InventarioMobileView({ session, setError, notify }) {
  const today = new Date().toISOString().split("T")[0];
  const [fecha, setFecha] = useState(today);
  const [insumos, setInsumos] = useState([]);
  const [registro, setRegistro] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    cargarInsumos();
    cargarRegistro();
  }, [fecha]);

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

  async function cargarRegistro() {
    try {
      const data = await request(`/api/inventario?fecha=${fecha}`);
      const reg = {};
      data.forEach((item) => {
        reg[item.insumo_id] = item;
      });
      setRegistro(reg);
    } catch {
      setRegistro({});
    }
  }

  async function guardar() {
    try {
      setGuardando(true);
      const items = insumos.map((ins) => {
        const item = registro[ins.id] || { insumo_id: ins.id, estado: "hay" };
        return {
          insumo_id: ins.id,
          estado: item.estado || "hay",
          cantidad: item.cantidad || null,
          notas: item.notas || null,
        };
      });
      await request("/api/inventario", {
        method: "POST",
        body: JSON.stringify({ fecha, items }),
      });
      notify("Inventario guardado correctamente", "success");
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  const filtrados = insumos.filter((ins) =>
    ins.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  if (cargando) {
    return <div className="mobile-loading">Cargando inventario...</div>;
  }

  return (
    <div className="inventario-mobile">
      <div className="inventario-header">
        <h1>📋 Inventario</h1>
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="fecha-input"
        />
      </div>

      <input
        type="text"
        placeholder="Buscar insumo..."
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        className="busqueda-input"
      />

      <div className="insumos-list">
        {filtrados.map((ins) => {
          const item = registro[ins.id] || { estado: "hay" };
          const esHay = item.estado === "hay";
          return (
            <div key={ins.id} className="insumo-item">
              <div className="insumo-nombre">
                <strong>{ins.nombre}</strong>
                <span className="insumo-categoria">{ins.categoria}</span>
              </div>
              <div className="insumo-controles">
                <button
                  className={`btn-estado ${esHay ? "activo" : ""}`}
                  onClick={() => {
                    setRegistro((cur) => ({
                      ...cur,
                      [ins.id]: { ...item, estado: "hay", cantidad: null },
                    }));
                  }}
                >
                  HAY
                </button>
                <button
                  className={`btn-estado ${!esHay ? "activo" : ""}`}
                  onClick={() => {
                    setRegistro((cur) => ({
                      ...cur,
                      [ins.id]: { ...item, estado: "traer" },
                    }));
                  }}
                >
                  TRAER
                </button>
                {!esHay && (
                  <input
                    type="number"
                    placeholder="Cant."
                    value={item.cantidad || ""}
                    onChange={(e) => {
                      setRegistro((cur) => ({
                        ...cur,
                        [ins.id]: { ...item, cantidad: e.target.value ? parseFloat(e.target.value) : null },
                      }));
                    }}
                    className="cantidad-input"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button className="btn-guardar" onClick={guardar} disabled={guardando}>
        {guardando ? "Guardando..." : "GUARDAR TURNO"}
      </button>
    </div>
  );
}
