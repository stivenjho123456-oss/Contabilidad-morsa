import { useCallback, useEffect, useMemo, useState } from "react";
import { request } from "../lib/api";
import { MONTH_NAMES } from "../lib/constants";
import { money } from "../lib/format";
import { DataTable } from "../components/ui";

export function CajaView({ reload, setError, notify }) {
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
    if (!c?.id) return;
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

      <div className="caja-filter-bar">
        <span className="caja-filter-label">Historial</span>
        <select value={month} onChange={(e) => setMonth(+e.target.value)} className="caja-select">
          {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(+e.target.value)} className="caja-select">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="caja-table-wrap">
        {loading ? (
          <div className="caja-empty">Cargando...</div>
        ) : lista.length === 0 ? (
          <div className="caja-empty">Sin movimientos ni bases de caja visibles en este período.</div>
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
                    <td>{c.observaciones || (c.has_current_base ? "—" : "Arrastre automático")}</td>
                    <td className="caja-actions">
                      <button className="caja-btn-edit" onClick={() => handleEdit(c)}>
                        {c.id ? "Editar" : "Fijar base"}
                      </button>
                      {c.id ? (
                        <button className="caja-btn-del" onClick={() => handleDelete(c)}>✕</button>
                      ) : null}
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

      {lista.length > 0 && (
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
      )}

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
            <div className="caja-live-row"><span>Entró hoy</span><strong>{money(ingresos)}</strong></div>
            <div className="caja-live-row"><span>Salió hoy</span><strong>{money(egresos)}</strong></div>
            <div className="caja-live-row"><span>Saldo actual del sistema</span><strong>{money(esperado)}</strong></div>
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
  const [form, setForm] = useState({ fecha: today, tipo: "SALIDA", valor: "", motivo: "", observaciones: "" });
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function handleSave() {
    if (!form.motivo.trim()) { setError("Debes escribir el motivo del ajuste manual."); return; }
    setSaving(true);
    try {
      await request("/api/caja/ajustes", {
        method: "POST",
        body: JSON.stringify({ ...form, valor: Number(form.valor || 0) }),
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
