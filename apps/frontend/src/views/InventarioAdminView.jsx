import { useEffect, useState } from "react";
import { request } from "../lib/api";

export function InventarioAdminView({ reload, setError, notify }) {
  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD en hora local
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

  function handlePrint() {
    window.print();
  }

  function handlePrintPOS() {
    const traerPorCategoria = {};
    registro.forEach((item) => {
      if (item.estado !== "traer") return;
      const cat = item.categoria || "General";
      if (!traerPorCategoria[cat]) traerPorCategoria[cat] = [];
      traerPorCategoria[cat].push(item);
    });

    const total = registro.filter((i) => i.estado === "traer").length;
    const sep = "--------------------------------";

    let lineas = "";
    Object.entries(traerPorCategoria).forEach(([cat, items]) => {
      lineas += `<div class="cat">${cat.toUpperCase()}</div>`;
      items.forEach((item) => {
        const notas = item.notas || (item.cantidad ? `${item.cantidad} ${item.unidad}` : "");
        lineas += `
          <div class="fila">
            <span class="nombre">${item.nombre}</span>
            ${notas ? `<span class="notas">${notas}</span>` : ""}
          </div>`;
      });
    });

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Inventario POS</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      width: 80mm;
      padding: 4mm 3mm;
      color: #000;
    }
    .titulo { font-size: 14px; font-weight: bold; text-align: center; }
    .subtitulo { text-align: center; font-size: 11px; margin-bottom: 4px; }
    .sep { border-top: 1px dashed #000; margin: 5px 0; }
    .cat {
      font-size: 10px; font-weight: bold; letter-spacing: 0.05em;
      margin-top: 7px; margin-bottom: 3px; text-decoration: underline;
    }
    .fila { margin-bottom: 4px; }
    .nombre { display: block; font-size: 12px; }
    .notas { display: block; font-size: 11px; padding-left: 8px; color: #333; }
    .total { text-align: right; font-size: 11px; margin-top: 6px; }
    @media print {
      body { width: 80mm; }
      @page { margin: 0; size: 80mm auto; }
    }
  </style>
</head>
<body>
  <div class="titulo">LA MORSA</div>
  <div class="subtitulo">Lista de compras — ${fechaLegible}</div>
  <div class="sep"></div>
  ${lineas}
  <div class="sep"></div>
  <div class="total">Total: ${total} ítem${total !== 1 ? "s" : ""}</div>
</body>
</html>`;

    const win = window.open("", "_blank", "width=400,height=600");
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 300);
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

  // Solo categorías que tengan al menos un ítem "traer"
  const byCategoriaTrae = {};
  registro.forEach((item) => {
    if (item.estado !== "traer") return;
    const cat = item.categoria || "General";
    if (!byCategoriaTrae[cat]) byCategoriaTrae[cat] = [];
    byCategoriaTrae[cat].push(item);
  });

  const totalTraer = registro.filter((i) => i.estado === "traer").length;
  const [dd, mm, yyyy] = fecha.split("-").reverse();
  const fechaLegible = `${dd}/${mm}/${yyyy}`;

  return (
    <div className="page-view">
      {/* ── Barra normal (oculta al imprimir) ── */}
      <div className="toolbar inv-admin-toolbar no-print">
        <div className="toolbar-left">
          <h2>Inventario Diario</h2>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="fecha-input"
            style={{ padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}
          />
          {totalTraer > 0 && (
            <>
              <button className="inv-print-btn no-print" onClick={handlePrint}>
                Imprimir A4
              </button>
              <button className="inv-print-btn inv-print-btn-pos no-print" onClick={handlePrintPOS}>
                Imprimir POS
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Vista normal (oculta al imprimir) ── */}
      <div className="panel no-print">
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
                  <div>Cantidad / Notas</div>
                </div>
                {items.map((item) => (
                  <div key={item.id} className="table-row">
                    <div>{item.nombre}</div>
                    <div>
                      <span className={`badge ${item.estado === "hay" ? "badge-hay" : "badge-traer"}`}>
                        {item.estado === "hay" ? "Hay" : "Traer"}
                      </span>
                    </div>
                    <div>{item.notas || (item.cantidad ? `${item.cantidad} ${item.unidad}` : "—")}</div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Hoja de impresión (solo visible al imprimir) ── */}
      <div className="inv-print-sheet print-only">
        <div className="inv-print-header">
          <div className="inv-print-title">Lista de compras — La Morsa</div>
          <div className="inv-print-fecha">{fechaLegible}</div>
        </div>

        {Object.keys(byCategoriaTrae).length === 0 ? (
          <p style={{ textAlign: "center", color: "#666" }}>Sin ítems para traer.</p>
        ) : (
          Object.entries(byCategoriaTrae).map(([categoria, items]) => (
            <div key={categoria} className="inv-print-categoria">
              <div className="inv-print-cat-titulo">{categoria}</div>
              {items.map((item) => (
                <div key={item.id} className="inv-print-fila">
                  <span className="inv-print-nombre">{item.nombre}</span>
                  <span className="inv-print-notas">
                    {item.notas || (item.cantidad ? `${item.cantidad} ${item.unidad}` : "")}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}

        <div className="inv-print-footer">
          Total: {totalTraer} ítem{totalTraer !== 1 ? "s" : ""} por traer
        </div>
      </div>
    </div>
  );
}
