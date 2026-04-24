import { useEffect, useState } from "react";
import { request } from "../lib/api";

export function InventarioAdminView({ reload, setError, notify }) {
  const today = new Date().toISOString().split("T")[0];
  const [fecha, setFecha] = useState(today);
  const [registro, setRegistro] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    cargarRegistro();
  }, [fecha]);

  async function cargarRegistro() {
    try {
      setCargando(true);
      const data = await request(`/api/inventario?fecha=${fecha}`);
      setRegistro(data);
    } catch (err) {
      setError(err.message);
      setRegistro([]);
    } finally {
      setCargando(false);
    }
  }

  if (cargando) {
    return <div className="loading-card">Cargando inventario...</div>;
  }

  const byCategoria = {};
  registro.forEach((item) => {
    const cat = item.categoria || "General";
    if (!byCategoria[cat]) byCategoria[cat] = [];
    byCategoria[cat].push(item);
  });

  return (
    <div className="page-view">
      <div className="toolbar">
        <div className="toolbar-left">
          <h2>📋 Inventario Diario</h2>
        </div>
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="fecha-input"
          style={{ padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}
        />
      </div>

      <div className="panel">
        {registro.length === 0 ? (
          <div style={{ padding: "20px", textAlign: "center", color: "#666" }}>
            No hay registro de inventario para esta fecha
          </div>
        ) : (
          Object.entries(byCategoria).map(([categoria, items]) => (
            <div key={categoria} style={{ marginBottom: "20px" }}>
              <h3 style={{ borderBottom: "2px solid #1e3a5f", paddingBottom: "10px" }}>
                {categoria}
              </h3>
              <div className="inventory-table">
                <div className="table-header">
                  <div>Insumo</div>
                  <div>Estado</div>
                  <div>Cantidad</div>
                </div>
                {items.map((item) => (
                  <div key={item.id} className="table-row">
                    <div>{item.nombre}</div>
                    <div>
                      <span
                        className={`badge ${item.estado === "hay" ? "badge-hay" : "badge-traer"}`}
                      >
                        {item.estado === "hay" ? "Hay" : "Traer"}
                      </span>
                    </div>
                    <div>{item.notas || (item.cantidad ? `${item.cantidad} ${item.unidad}` : "-")}</div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
