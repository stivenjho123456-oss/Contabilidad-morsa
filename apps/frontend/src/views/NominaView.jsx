import { useState } from "react";
import { downloadExcelFile, request } from "../lib/api";
import { money, formatDateLabel, initials } from "../lib/format";
import { Field, Modal } from "../components/ui";

const EMPTY_NOVEDAD = {
  fecha: new Date().toISOString().slice(0, 10),
  empleado: "", cedula: "", quincena: "Q1",
  naturaleza: "DEVENGADO", tipo_novedad: "BONIFICACION",
  valor: "", observaciones: "",
};

const EMPTY_ASISTENCIA = {
  empleado: "", cedula: "", dia: "", quincena: "Q1", estado: "LABORADO",
};

function AsistenciaModal({ periodo, data, onClose, onSaved, setError, notify }) {
  const [form, setForm] = useState({ ...EMPTY_ASISTENCIA, ...(data || {}) });
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    try {
      setSaving(true);
      const payload = { ...form, periodo, dia: Number(form.dia) };
      if (data?.id) {
        await request(`/api/nomina/asistencia/${data.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await request("/api/nomina/asistencia", { method: "POST", body: JSON.stringify(payload) });
      }
      onSaved();
      notify(data?.id ? "Asistencia actualizada" : "Asistencia registrada", "success");
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={data?.id ? "Editar Asistencia" : "Nueva Asistencia"} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <Field label="Empleado">
          <input required value={form.empleado} onChange={set("empleado")} />
        </Field>
        <Field label="Cédula">
          <input value={form.cedula} onChange={set("cedula")} />
        </Field>
        <Field label="Día">
          <input required type="number" min="1" max="31" value={form.dia} onChange={set("dia")} />
        </Field>
        <Field label="Quincena">
          <select value={form.quincena} onChange={set("quincena")}>
            <option value="Q1">Q1</option>
            <option value="Q2">Q2</option>
          </select>
        </Field>
        <Field label="Estado">
          <select value={form.estado} onChange={set("estado")}>
            <option value="LABORADO">LABORADO</option>
            <option value="DOMINGO_FESTIVO">DOMINGO / FESTIVO</option>
            <option value="NO_FUE">NO FUE</option>
            <option value="INCAPACIDAD">INCAPACIDAD</option>
            <option value="PERMISO_NO_REMUNERADO">PERMISO NO REMUNERADO</option>
            <option value="CITA_MEDICA">CITA MÉDICA</option>
            <option value="VACACIONES">VACACIONES</option>
          </select>
        </Field>
        <div className="modal-footer">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn-save" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

function NovedadModal({ periodo, data, onClose, onSaved, setError, notify }) {
  const [form, setForm] = useState({ ...EMPTY_NOVEDAD, ...(data || {}) });
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    try {
      setSaving(true);
      const payload = { ...form, periodo, valor: Number(form.valor || 0) };
      if (data?.id) {
        await request(`/api/nomina/novedades/${data.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await request("/api/nomina/novedades", { method: "POST", body: JSON.stringify(payload) });
      }
      onSaved();
      notify(data?.id ? "Novedad actualizada" : "Novedad creada", "success");
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={data?.id ? "Editar Novedad" : "Nueva Novedad"} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <Field label="Fecha">
          <input required type="date" value={form.fecha} onChange={set("fecha")} />
        </Field>
        <Field label="Empleado">
          <input required value={form.empleado} onChange={set("empleado")} />
        </Field>
        <Field label="Cédula">
          <input value={form.cedula} onChange={set("cedula")} />
        </Field>
        <Field label="Quincena">
          <select value={form.quincena} onChange={set("quincena")}>
            <option value="Q1">Q1</option>
            <option value="Q2">Q2</option>
            <option value="MES">MES</option>
          </select>
        </Field>
        <Field label="Naturaleza">
          <select value={form.naturaleza} onChange={set("naturaleza")}>
            <option value="DEVENGADO">DEVENGADO</option>
            <option value="DEDUCCION">DEDUCCION</option>
          </select>
        </Field>
        <Field label="Tipo de novedad">
          <input required value={form.tipo_novedad} onChange={set("tipo_novedad")} />
        </Field>
        <Field label="Valor">
          <input required type="number" min="1" value={form.valor} onChange={set("valor")} />
        </Field>
        <Field label="Observaciones">
          <textarea rows={3} value={form.observaciones} onChange={set("observaciones")} />
        </Field>
        <div className="modal-footer">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn-save" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function NominaView({ nomina, periodoNomina, setPeriodoNomina, reload, setError, notify }) {
  const stats = nomina.stats || {};
  const resumen = nomina.resumen || [];
  const asistencia = nomina.asistencia || [];
  const asistenciaResumen = nomina.asistencia_resumen || [];
  const seg = nomina.seg_social || [];
  const novedades = nomina.novedades || [];
  const workflow = nomina.workflow || { steps: [] };
  const [selectedAsistencia, setSelectedAsistencia] = useState(null);
  const [selectedNovedad, setSelectedNovedad] = useState(null);
  const [novedadModal, setNovedadModal] = useState(null);
  const [asistenciaModal, setAsistenciaModal] = useState(null);
  const totalDesembolso = resumen.reduce((acc, row) => acc + Number(row.total_mes || 0), 0);
  const pendientes = novedades.filter((row) => String(row.tipo_novedad || "").trim()).length;
  const topEmpleado = [...resumen].sort((a, b) => Number(b.total_mes || 0) - Number(a.total_mes || 0))[0];

  const socialGroups = Object.values(seg.reduce((acc, row) => {
    const key = row.grupo || row.concepto || "OTRO";
    if (!acc[key]) acc[key] = { concepto: key, empresa: 0, empleado: 0 };
    const valor = Number(row.valor || 0);
    acc[key].empresa += valor;
    if (/eps|pension|salud/i.test(String(row.concepto || ""))) acc[key].empleado += valor * 0.32;
    return acc;
  }, {}));

  const workflowGuide = [
    { key: "asistencia",  stepNumber: 1, title: "Preparar base del período",           short: "Carga los días o soportes del período antes de liquidar.",                action: "Registrar soporte diario" },
    { key: "liquidacion", stepNumber: 2, title: "Revisar liquidación por empleado",     short: "Confirma días, valores y netos de Q1 y Q2.",                              action: "Validar liquidación" },
    { key: "novedades",   stepNumber: 3, title: "Aplicar novedades",                    short: "Agrega bonificaciones, descuentos o ajustes manuales.",                   action: "Registrar novedad" },
    { key: "seg_social",  stepNumber: 4, title: "Validar seguridad social",             short: "Revisa aportes patronales y totales del período.",                        action: "Revisar conceptos" },
    { key: "integracion", stepNumber: 5, title: "Sincronizar y cerrar",                 short: "Lleva la nómina a egresos contables y deja listo el cierre.",             action: "Sincronizar egresos" },
  ].map((guide) => {
    const real = (workflow.steps || []).find((step) => step.step === guide.key) || {};
    return { ...guide, completed: !!real.completed, count: real.count ?? 0, detail: real.detail || guide.short };
  });

  const nextStep = workflowGuide.find((step) => !step.completed) || workflowGuide[workflowGuide.length - 1];

  function jumpToNominaSection(sectionId) {
    const node = document.getElementById(sectionId);
    if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleSync() {
    try {
      const result = await request("/api/nomina/sync", {
        method: "POST",
        body: JSON.stringify({ periodo: periodoNomina || null }),
      });
      reload();
      notify(`Nómina sincronizada. ${result.egresos_generados ?? 0} egresos generados.`, "success");
    } catch (err) { setError(err.message); }
  }

  async function handleDeleteNovedad() {
    if (!selectedNovedad) { alert("Selecciona una novedad para eliminar."); return; }
    if (!window.confirm("¿Eliminar esta novedad?")) return;
    try {
      await request(`/api/nomina/novedades/${selectedNovedad.id}`, { method: "DELETE" });
      setSelectedNovedad(null);
      reload();
      notify("Novedad eliminada", "success");
    } catch (err) { setError(err.message); }
  }

  async function handleDeleteAsistencia() {
    if (!selectedAsistencia) { alert("Selecciona un registro de asistencia para eliminar."); return; }
    if (!window.confirm("¿Eliminar este registro de asistencia?")) return;
    try {
      await request(`/api/nomina/asistencia/${selectedAsistencia.id}`, { method: "DELETE" });
      setSelectedAsistencia(null);
      reload();
      notify("Asistencia eliminada", "success");
    } catch (err) { setError(err.message); }
  }

  async function handleExportNomina() {
    if (!periodoNomina) { setError("Selecciona un período de nómina para exportar."); return; }
    await downloadExcelFile(
      `/api/export/nomina?periodo=${encodeURIComponent(periodoNomina)}`,
      `Nomina_${periodoNomina.replaceAll(" ", "_")}.xlsx`,
      setError, notify
    );
  }

  return (
    <div className="page-view nomina-view">
      <div className="nomina-header">
        <div>
          <div className="nomina-breadcrumb">Morsa / Gestión de Nómina</div>
          <h2 className="nomina-title">Consolidado Mensual</h2>
        </div>
        <div className="nomina-header-actions">
          <select value={periodoNomina} onChange={(e) => setPeriodoNomina(e.target.value)}>
            {(nomina.periodos || []).map((p) => <option key={p}>{p}</option>)}
          </select>
          <button type="button" className="nomina-ghost-btn" onClick={handleExportNomina}>Exportar Excel</button>
          <button type="button" className="nomina-ghost-btn" onClick={() => setAsistenciaModal("new")}>Nueva Asistencia</button>
          <button type="button" className="nomina-ghost-btn" onClick={() => setNovedadModal("new")}>Nueva Novedad</button>
          <button type="button" className="nomina-ghost-btn" onClick={handleSync}>Sincronizar Egresos</button>
          <div className="nomina-dark-btn nomina-status-chip">
            {workflow.ready_to_close ? "Listo para cierre" : "Cierre pendiente"}
          </div>
        </div>
      </div>

      <section className="nomina-section">
        <div className="nomina-mini-head">
          <div>
            <h3>Paso a Paso de la Nómina</h3>
            <p>{workflow.completed_steps || 0} de {workflow.total_steps || 0} pasos completos para {workflow.periodo || periodoNomina}.</p>
          </div>
          <span className="nomina-link-btn nomina-link-badge">{workflow.ready_to_close ? "Listo para cierre" : `Sigue: Paso ${nextStep?.stepNumber || 1}`}</span>
        </div>
        <div className="nomina-next-step">
          <div className="nomina-next-step-copy">
            <span>Siguiente paso recomendado</span>
            <strong>Paso {nextStep?.stepNumber || 1}: {nextStep?.title || "Continuar proceso"}</strong>
            <p>{nextStep?.short || "Completa la siguiente etapa para avanzar con el cierre."}</p>
          </div>
          <button
            type="button"
            className="nomina-next-step-btn"
            onClick={() => {
              if (nextStep?.key === "asistencia") setAsistenciaModal("new");
              else if (nextStep?.key === "novedades") setNovedadModal("new");
              else if (nextStep?.key === "integracion") handleSync();
              else if (nextStep?.key === "liquidacion") jumpToNominaSection("nomina-liquidacion");
              else if (nextStep?.key === "seg_social") jumpToNominaSection("nomina-seg-social");
            }}
          >
            {nextStep?.action || "Continuar"}
          </button>
        </div>
        <div className="nomina-workflow-grid">
          {workflowGuide.map((step) => (
            <div key={step.key} className={`nomina-workflow-card ${step.completed ? "done" : ""}`}>
              <div className="nomina-workflow-topline">
                <span className="nomina-workflow-step">Paso {step.stepNumber}</span>
                <span className={`nomina-workflow-state ${step.completed ? "done" : "pending"}`}>
                  {step.completed ? "Completado" : "Pendiente"}
                </span>
              </div>
              <strong>{step.title}</strong>
              <b>{step.count ?? 0}</b>
              <p>{step.short}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="nomina-bento">
        <div className="nomina-kpi violet">
          <span>Empleados Activos</span>
          <strong>{stats.empleados ?? 0}</strong>
          <p>{topEmpleado ? `${topEmpleado.empleado} lidera el periodo.` : "Sin empleados cargados."}</p>
        </div>
        <div className="nomina-kpi black">
          <span>Total Nómina</span>
          <strong>{money(stats.total_nomina)}</strong>
          <p>Proyectado mensual actual.</p>
        </div>
        <div className="nomina-kpi rose">
          <span>Novedades</span>
          <strong>{pendientes}</strong>
          <p>{money(stats.total_novedades_devengado)} en devengados manuales.</p>
        </div>
        <div className="nomina-kpi green">
          <span>Asistencia</span>
          <strong>{stats.dias_laborados ?? 0} días</strong>
          <p>{stats.registros_asistencia ?? 0} empleados con asistencia consolidada.</p>
        </div>
        <div className="nomina-kpi dark">
          <span>Nómina Integrada</span>
          <strong>{money(stats.total_nomina_integrada)}</strong>
          <p>{stats.empleados ? `${Math.round(((stats.total_nomina_integrada || 0) / Math.max(totalDesembolso, 1)) * 100)}% del desembolso directo.` : "Pendiente de consolidación."}</p>
        </div>
      </div>

      <section className="nomina-section" id="nomina-liquidacion">
        <div className="nomina-section-head">
          <h3>Empleados en Nómina</h3>
          <div className="nomina-tabset">
            <span className="nomina-tab-label active">Q1 & Q2</span>
            <span className="nomina-tab-label">Detalle individual próximamente</span>
          </div>
        </div>
        <div className="nomina-table-wrap">
          <table className="nomina-table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th className="center">Cédula</th>
                <th className="right">Valor Día</th>
                <th className="center">Días Q1/Q2</th>
                <th className="right">Neto Q1</th>
                <th className="right">Neto Q2</th>
                <th className="right">Deducciones</th>
                <th className="right">Total Mes</th>
              </tr>
            </thead>
            <tbody>
              {resumen.length ? resumen.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="nomina-employee">
                      <div className="nomina-avatar">{initials(row.empleado)}</div>
                      <div className="nomina-employee-text">
                        <strong>{row.empleado}</strong>
                        <span>{Number(row.total_mes || 0) >= Number(stats.total_nomina || 0) / Math.max(stats.empleados || 1, 1) ? "Carga alta del periodo" : "Empleado activo"}</span>
                      </div>
                    </div>
                  </td>
                  <td className="center mono">{row.cedula}</td>
                  <td className="right strong">{money(row.valor_dia)}</td>
                  <td className="center">
                    <span className={`nomina-days ${Number(row.q2_dias || 0) === 0 ? "alert" : ""}`}>
                      {row.q1_dias} / {row.q2_dias}
                    </span>
                  </td>
                  <td className="right">{money(row.q1_neto)}</td>
                  <td className="right">{money(row.q2_neto)}</td>
                  <td className="right danger">{money(row.total_deduccion)}</td>
                  <td className="right total">{money(row.total_mes)}</td>
                </tr>
              )) : (
                <tr><td colSpan={8} className="nomina-empty">Sin información de nómina para este período.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7}>Total Desembolso Mes</td>
                <td className="right">{money(totalDesembolso)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="nomina-section">
        <div className="nomina-section-head">
          <h3>Asistencia Consolidada</h3>
          <div className="nomina-tabset">
            <button type="button" className="active">Resumen</button>
            <button type="button" onClick={() => {
              if (!selectedAsistencia) { alert("Selecciona un registro de asistencia para editar."); return; }
              setAsistenciaModal("edit");
            }}>Editar día</button>
            <button type="button" onClick={handleDeleteAsistencia}>Eliminar día</button>
          </div>
        </div>
        <div className="nomina-table-wrap">
          <table className="nomina-table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th className="center">Cédula</th>
                <th className="center">Q1</th>
                <th className="center">Q2</th>
                <th className="center">Laborados</th>
                <th className="center">Incapacidad</th>
                <th className="center">Vacaciones</th>
                <th className="center">No fue</th>
              </tr>
            </thead>
            <tbody>
              {asistenciaResumen.length ? asistenciaResumen.map((row, idx) => {
                const matchedAsistencia = asistencia.find((item) => item.empleado === row.empleado) || null;
                const rowSelected = selectedAsistencia && selectedAsistencia.empleado === row.empleado;
                return (
                  <tr key={`${row.empleado}-${idx}`} className={rowSelected ? "row-selected-lite" : ""} onClick={() => setSelectedAsistencia(matchedAsistencia)}>
                    <td>
                      <div className="nomina-employee">
                        <div className="nomina-avatar">{initials(row.empleado)}</div>
                        <div className="nomina-employee-text">
                          <strong>{row.empleado}</strong>
                          <span>{row.dias_laborados} días marcados en el período</span>
                        </div>
                      </div>
                    </td>
                    <td className="center mono">{row.cedula}</td>
                    <td className="center">{row.q1_laborados}</td>
                    <td className="center">{row.q2_laborados}</td>
                    <td className="center strong">{row.dias_laborados}</td>
                    <td className="center">{row.dias_incapacidad}</td>
                    <td className="center">{row.dias_vacaciones}</td>
                    <td className="center danger">{row.dias_no_fue}</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={8} className="nomina-empty">Sin asistencia consolidada para este período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="nomina-bottom-grid">
        <section className="nomina-section" id="nomina-seg-social">
          <div className="nomina-mini-head">
            <div>
              <h3>Detalle de Seguridad Social</h3>
              <p>Cálculos causados con base en la información importada.</p>
            </div>
          </div>
          <div className="nomina-subtable-wrap">
            <table className="nomina-subtable">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th className="right">Aporte Empresa</th>
                  <th className="right">Aporte Empleado</th>
                </tr>
              </thead>
              <tbody>
                {socialGroups.length ? socialGroups.map((row) => (
                  <tr key={row.concepto}>
                    <td>{row.concepto}</td>
                    <td className="right green">{money(row.empresa)}</td>
                    <td className="right">{money(row.empleado)}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={3} className="nomina-empty">Sin conceptos de seguridad social.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td>Gran Total</td>
                  <td colSpan={2} className="right">{money(stats.total_seg_social)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <div className="nomina-side-stack">
          <section className="nomina-section">
            <div className="nomina-mini-head">
              <div>
                <h3>Novedades Pendientes</h3>
                <p>{novedades.length} registros visibles en el período.</p>
              </div>
              <span className="nomina-link-btn nomina-link-badge">{asistencia.length} días registrados</span>
            </div>
            <div className="nomina-activity-list">
              {novedades.length ? novedades.slice(0, 4).map((row) => (
                <div
                  key={row.id}
                  className={`nomina-activity ${String(row.naturaleza).toUpperCase() === "DEDUCCION" ? "danger" : ""} ${selectedNovedad?.id === row.id ? "active" : ""}`}
                  onClick={() => setSelectedNovedad(row)}
                >
                  <div className="nomina-activity-icon">{String(row.tipo_novedad || "N").slice(0, 1)}</div>
                  <div className="nomina-activity-copy">
                    <strong>{row.tipo_novedad || "Novedad"}: {row.empleado}</strong>
                    <p>{row.quincena} · {row.naturaleza} · {money(row.valor)}</p>
                  </div>
                  <span>{formatDateLabel(row.fecha)}</span>
                </div>
              )) : (
                <div className="nomina-activity-empty">No hay novedades manuales registradas.</div>
              )}
            </div>
            <div className="nomina-mini-actions">
              <button type="button" className="nomina-link-btn" onClick={() => {
                if (!selectedNovedad) { alert("Selecciona una novedad para editar."); return; }
                setNovedadModal("edit");
              }}>Editar</button>
              <button type="button" className="nomina-danger-link" onClick={handleDeleteNovedad}>Eliminar</button>
            </div>
          </section>

          <section className="nomina-shortcut">
            <div>
              <h4>Registro Diario</h4>
              <p>Carga asistencia, incapacidades, vacaciones y ausencias antes de sincronizar a egresos.</p>
              <button type="button" onClick={() => setAsistenciaModal("new")}>Registrar Día</button>
            </div>
            <div className="nomina-shortcut-mark">$</div>
          </section>
        </div>
      </div>

      {novedadModal === "new" && <NovedadModal periodo={periodoNomina} data={null} onClose={() => setNovedadModal(null)} onSaved={reload} setError={setError} notify={notify} />}
      {asistenciaModal === "new" && <AsistenciaModal periodo={periodoNomina} data={null} onClose={() => setAsistenciaModal(null)} onSaved={reload} setError={setError} notify={notify} />}
      {asistenciaModal === "edit" && selectedAsistencia && <AsistenciaModal periodo={periodoNomina} data={selectedAsistencia} onClose={() => setAsistenciaModal(null)} onSaved={reload} setError={setError} notify={notify} />}
      {novedadModal === "edit" && selectedNovedad && <NovedadModal periodo={periodoNomina} data={selectedNovedad} onClose={() => setNovedadModal(null)} onSaved={reload} setError={setError} notify={notify} />}
    </div>
  );
}
