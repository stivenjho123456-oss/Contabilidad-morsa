import { useDeferredValue, useMemo, useState } from "react";
import { downloadExcelFile, openProtectedFile, request, uploadSupportFile } from "../lib/api";
import { MONTH_NAMES, TIPO_COLORS } from "../lib/constants";
import { money } from "../lib/format";
import { Field, Modal } from "../components/ui";

const TIPO_GASTO_OPTS = ["COSTO","GASTO","SERVICIOS","EMPLEADO","SEG SOCIAL"];

function egresoTipoClass(tipo) {
  const normalized = String(tipo || "").toUpperCase();
  if (normalized === "COSTO") return "violet";
  if (normalized === "GASTO") return "slate";
  if (normalized === "SERVICIOS") return "amber";
  if (normalized === "EMPLEADO") return "blue";
  if (normalized === "SEG SOCIAL") return "rose";
  return "slate";
}

function EgresosLedgerTable({ rows, selectedId, onSelect }) {
  return (
    <div className="ledger-shell">
      <div className="ledger-table-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>N° Doc</th>
              <th>Proveedor / Razón</th>
              <th>NIT</th>
              <th>Valor</th>
              <th>Naturaleza G.</th>
              <th>Factura</th>
              <th>Soporte</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr
                key={row.id}
                className={row.id === selectedId ? "is-selected" : ""}
                onClick={() => onSelect?.(row)}
              >
                <td>{row.fecha}</td>
                <td className="ledger-doc">{row.no_documento || "Sin doc."}</td>
                <td>
                  <div className="ledger-vendor">
                    <div className="ledger-avatar">
                      {(row.razon_social || "?").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="ledger-vendor-text">
                      <strong>{row.razon_social || "Sin proveedor"}</strong>
                      <span>{row.observaciones || "Registro contable"}</span>
                    </div>
                  </div>
                </td>
                <td>{row.nit || "NIT N/A"}</td>
                <td className="ledger-value">{money(row.valor)}</td>
                <td>
                  <span className={`ledger-badge ${egresoTipoClass(row.tipo_gasto)}`}>
                    {row.tipo_gasto || "OTRO"}
                  </span>
                </td>
                <td className="ledger-center">
                  <span className={`ledger-factura ${row.factura_electronica === "SI" ? "yes" : "no"}`}>
                    {row.factura_electronica === "SI" ? "Sí" : "No"}
                  </span>
                </td>
                <td className="ledger-center">
                  <span className={`ledger-factura ${row.has_support ? "yes" : "no"}`}>
                    {row.has_support ? "Adjunto" : "Sin soporte"}
                  </span>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={8} className="ledger-empty">
                  <div className="ledger-empty-block">
                    <strong>No se encontraron egresos</strong>
                    <span>Comienza registrando un movimiento para ver el libro mayor en tiempo real.</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const EMPTY_EG = {
  fecha: new Date().toISOString().slice(0, 10),
  no_documento: "", razon_social: "", nit: "", valor: "",
  tipo_gasto: "COSTO", canal_pago: "Otro", factura_electronica: "NO", observaciones: "", has_support: false, soporte_name: "",
};

function EgresoModal({ data, proveedores, onClose, onSaved, setError, notify }) {
  const [form, setForm] = useState({ ...EMPTY_EG, ...(data || {}) });
  const [saving, setSaving] = useState(false);
  const [supportFile, setSupportFile] = useState(null);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const proveedoresOrdenados = useMemo(
    () => [...(proveedores || [])].sort((a, b) => String(a.razon_social || "").localeCompare(String(b.razon_social || ""), "es")),
    [proveedores]
  );

  function handleProveedorChange(e) {
    const razonSocial = e.target.value;
    const proveedor = proveedoresOrdenados.find((item) => item.razon_social === razonSocial);
    setForm((prev) => ({
      ...prev,
      razon_social: razonSocial,
      nit: proveedor?.nit || "",
      proveedor_id: proveedor?.id ?? null,
    }));
  }

  async function submit(e) {
    e.preventDefault();
    try {
      setSaving(true);
      const proveedor = proveedoresOrdenados.find((item) => item.razon_social === form.razon_social);
      const body = {
        ...form,
        valor: Number(form.valor || 0),
        consecutivo: "",
        proveedor_id: proveedor?.id ?? form.proveedor_id ?? null,
        nit: proveedor?.nit || form.nit || "",
      };
      if (data?.id)
        await request(`/api/egresos/${data.id}`, { method: "PUT", body: JSON.stringify(body) });
      else
        body.id = (await request("/api/egresos", { method: "POST", body: JSON.stringify(body) }))?.id;
      const entityId = data?.id || body.id;
      if (supportFile && entityId) {
        await uploadSupportFile(`/api/egresos/${entityId}/soporte`, supportFile, setError, notify);
      }
      onSaved();
      notify(data?.id ? "Egreso actualizado" : "Egreso registrado", "success");
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={data?.id ? "Editar Egreso" : "Nuevo Egreso"} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <Field label="Fecha">
          <input required type="date" value={form.fecha} onChange={set("fecha")} />
        </Field>
        <Field label="N° Documento">
          <input value={form.no_documento} onChange={set("no_documento")} />
        </Field>
        <Field label="Proveedor / Razón Social *">
          <select required value={form.razon_social} onChange={handleProveedorChange}>
            <option value="">Selecciona un proveedor</option>
            {proveedoresOrdenados.map((proveedor) => (
              <option key={proveedor.id} value={proveedor.razon_social}>
                {proveedor.razon_social}
              </option>
            ))}
          </select>
        </Field>
        <Field label="NIT">
          <input value={form.nit} onChange={set("nit")} readOnly />
        </Field>
        <Field label="Valor *">
          <input required type="number" min="1" value={form.valor} onChange={set("valor")} />
        </Field>
        <Field label="Naturaleza del Gasto">
          <select value={form.tipo_gasto} onChange={set("tipo_gasto")}>
            {TIPO_GASTO_OPTS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Canal de Pago">
          <select value={form.canal_pago ?? "Otro"} onChange={set("canal_pago")}>
            <option value="Caja">Caja (efectivo)</option>
            <option value="Bancos">Bancos</option>
            <option value="Tarjeta CR">Tarjeta CR</option>
            <option value="Otro">Otro</option>
          </select>
        </Field>
        <Field label="Factura Electrónica">
          <select value={form.factura_electronica} onChange={set("factura_electronica")}>
            <option value="NO">No</option>
            <option value="SI">Sí</option>
          </select>
        </Field>
        <Field label="Observaciones">
          <textarea value={form.observaciones} onChange={set("observaciones")} rows={3} />
        </Field>
        <Field label="Soporte documental">
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setSupportFile(e.target.files?.[0] || null)} />
          {data?.soporte_name && <small>Actual: {data.soporte_name}</small>}
        </Field>
        <div className="modal-footer">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn-save" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function EgresosView({ egresos, proveedores, year, month, setYear, setMonth, years, periodClosed, reload, setError, notify }) {
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState("Todos");
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null);
  const deferredSearch = useDeferredValue(search);

  const tipos = useMemo(() => (
    ["Todos", ...Array.from(new Set(egresos.map((e) => e.tipo_gasto).filter(Boolean)))]
  ), [egresos]);

  const filtered = egresos.filter((e) => {
    const matchTipo   = tipoFilter === "Todos" || e.tipo_gasto === tipoFilter;
    const matchSearch = !search ||
      `${e.razon_social} ${e.nit} ${e.no_documento}`.toLowerCase().includes(deferredSearch.toLowerCase());
    return matchTipo && matchSearch;
  });

  const totalVisible = filtered.reduce((acc, row) => acc + Number(row.valor || 0), 0);
  const facturaCount = filtered.filter((row) => row.factura_electronica === "SI").length;
  const topTipo = Object.entries(filtered.reduce((acc, row) => {
    const key = row.tipo_gasto || "OTRO";
    acc[key] = (acc[key] || 0) + Number(row.valor || 0);
    return acc;
  }, {})).sort((a, b) => b[1] - a[1])[0]?.[0] || "Sin datos";

  async function handleDelete() {
    if (!selected) { alert("Selecciona un egreso para eliminar."); return; }
    if (!window.confirm("¿Eliminar este egreso?")) return;
    try {
      await request(`/api/egresos/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      reload();
      notify("Egreso eliminado", "success");
    } catch (err) { setError(err.message); }
  }

  async function handleExport() {
    const params = new URLSearchParams({ mes: String(month), ano: String(year) });
    if (tipoFilter && tipoFilter !== "Todos") params.set("tipo", tipoFilter);
    if (search.trim()) params.set("search", search.trim());
    await downloadExcelFile(`/api/export/egresos?${params.toString()}`, `Egresos_${month}_${year}.xlsx`, setError, notify);
  }

  return (
    <div className="page-view">
      <div className="egresos-hero">
        <div className="egresos-hero-card primary">
          <span className="eyebrow">Total visible</span>
          <strong>{money(totalVisible)}</strong>
          <p>Calculado sobre {filtered.length} transacciones visibles.</p>
        </div>
        <div className="egresos-hero-card">
          <span className="eyebrow">Registros</span>
          <strong>{filtered.length}</strong>
          <p>{Math.max(tipos.length - 1, 0)} naturalezas distintas en pantalla.</p>
        </div>
        <div className="egresos-hero-card">
          <span className="eyebrow">Naturaleza líder</span>
          <strong>{topTipo}</strong>
          <p>{facturaCount} movimientos con factura electrónica.</p>
        </div>
      </div>

      <div className="egresos-controls">
        <div className="egresos-controls-left">
          <div className="egresos-control-chip">
            <span>{MONTH_NAMES[month - 1]} {year}</span>
          </div>
          <input className="search-input egresos-search" placeholder="Buscar proveedor, NIT o documento..." value={search}
            onChange={(e) => setSearch(e.target.value)} />
          <select value={tipoFilter} onChange={(e) => setTipoFilter(e.target.value)}>
            {tipos.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="egresos-controls-right">
          <button type="button" className="egresos-icon-btn" onClick={handleExport}>Exportar Excel</button>
          <button
            type="button"
            className="egresos-icon-btn"
            disabled={!selected?.has_support}
            onClick={() => openProtectedFile(`/api/egresos/${selected.id}/soporte`, selected?.soporte_name || `soporte_${selected?.id}`, setError)}
          >
            Ver Soporte
          </button>
          <button type="button" className="egresos-icon-btn" disabled={periodClosed} onClick={() => {
            if (!selected) { alert("Selecciona un egreso para editar."); return; }
            setModal("edit");
          }}>Editar</button>
          <button type="button" className="egresos-icon-btn danger" disabled={periodClosed} onClick={handleDelete}>Eliminar</button>
          <button type="button" className="egresos-primary-btn" disabled={periodClosed} onClick={() => setModal("new")}>Registrar Egreso</button>
        </div>
      </div>

      <div className="panel egresos-ledger-panel">
        <div className="egresos-ledger-head">
          <div>
            <h3 className="panel-title">Libro de Egresos</h3>
            <p className="status-text">
              {filtered.length} registros visibles. {periodClosed ? "Período cerrado para edición." : "Selecciona una fila para editar o eliminar."}
            </p>
          </div>
          {selected && (
            <div className="egresos-selection-chip">
              Seleccionado: {(selected.razon_social || "Sin proveedor").slice(0, 34)}
            </div>
          )}
        </div>
        <EgresosLedgerTable rows={filtered} selectedId={selected?.id} onSelect={setSelected} />
      </div>

      {modal === "new"  && <EgresoModal data={null}     proveedores={proveedores} onClose={() => setModal(null)} onSaved={reload} setError={setError} notify={notify} />}
      {modal === "edit" && <EgresoModal data={selected} proveedores={proveedores} onClose={() => setModal(null)} onSaved={reload} setError={setError} notify={notify} />}
    </div>
  );
}
