import { useState } from "react";
import { downloadExcelFile, request } from "../lib/api";
import { MONTH_NAMES } from "../lib/constants";
import { money } from "../lib/format";
import { DataTable, Field, MetricStrip, Modal, TBtn, Toolbar } from "../components/ui";

const CANAL_COLORS = { "Caja": "#1e3a5f", "Bancos": "#2563eb", "Tarjeta CR": "#7c3aed" };
const CANAL_LIGHT  = { "Caja": "#dbeafe",  "Bancos": "#ede9fe",  "Tarjeta CR": "#f3e8ff" };

function AnalisisIngresos({ analisis }) {
  if (!analisis) return null;
  const { canales, meses, total_global, meses_con_datos } = analisis;
  const lider = canales[0];

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

      <div className="analisis-canales">
        {canales.map((c, i) => (
          <div key={c.canal} className="analisis-canal-card" style={{ borderTopColor: CANAL_COLORS[c.canal] }}>
            <div className="analisis-canal-top">
              <span className="analisis-canal-name" style={{ color: CANAL_COLORS[c.canal] }}>{c.canal}</span>
              {i === 0 && <span className="analisis-canal-crown">★ Líder</span>}
            </div>
            <strong className="analisis-canal-total">{money(c.total)}</strong>
            <div className="analisis-bar-track">
              <div className="analisis-bar-fill" style={{ width: `${c.pct}%`, background: CANAL_COLORS[c.canal] }} />
            </div>
            <div className="analisis-canal-stats">
              <span><b>{c.pct}%</b> del total</span>
              <span>Prom. mensual: <b>{money(c.promedio_mensual)}</b></span>
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h4 className="panel-title">Detalle por mes</h4>
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mes</th><th>Días</th>
                <th style={{ color: "#93c5fd" }}>Caja</th>
                <th style={{ color: "#c4b5fd" }}>Bancos</th>
                <th style={{ color: "#f0abfc" }}>Tarjeta CR</th>
                <th>Total</th><th>Canal líder del mes</th>
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

      <div className="panel">
        <h4 className="panel-title">Consolidado por año</h4>
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Año</th><th>Meses</th>
                <th style={{ color: "#93c5fd" }}>Caja</th>
                <th style={{ color: "#c4b5fd" }}>Bancos</th>
                <th style={{ color: "#f0abfc" }}>Tarjeta CR</th>
                <th>Total año</th><th>Prom. mensual</th>
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
        caja:       Number(form.caja      || 0),
        bancos:     Number(form.bancos    || 0),
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

export function IngresosView({ ingresos, year, month, setYear, setMonth, years, periodClosed, analisis, reload, setError, notify }) {
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
