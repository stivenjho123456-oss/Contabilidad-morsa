import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { request, downloadExcelFile } from "../lib/api";
import { MONTH_NAMES } from "../lib/constants";
import { money } from "../lib/format";
import { DataTable, StatCard, TBtn, Toolbar } from "../components/ui";

export function ReportesView({ reporte, auditoria, year, month, setYear, setMonth, years, reload, setError, notify }) {
  const cierre = reporte?.cierre || {};

  // Ingresos por fuente (sumar caja, bancos, tarjeta_cr de todos los registros del mes)
  const ingresosFuente = (reporte?.ingresos || []).reduce(
    (acc, row) => ({
      caja: acc.caja + Number(row.caja || 0),
      bancos: acc.bancos + Number(row.bancos || 0),
      tarjeta_cr: acc.tarjeta_cr + Number(row.tarjeta_cr || 0),
    }),
    { caja: 0, bancos: 0, tarjeta_cr: 0 }
  );
  const pieData = [
    { name: "Efectivo", value: ingresosFuente.caja, color: "#16a34a" },
    { name: "Bancos", value: ingresosFuente.bancos, color: "#2563eb" },
    { name: "Tarjeta CR", value: ingresosFuente.tarjeta_cr, color: "#7c3aed" },
  ].filter((d) => d.value > 0);

  // Ingresos vs Egresos para bar chart
  const barData = [
    { name: "Ingresos", valor: cierre.total_ingresos || 0, fill: "#16a34a" },
    { name: "Egresos Op.", valor: cierre.egresos_operativos || 0, fill: "#ea580c" },
    { name: "Nómina", valor: cierre.egresos_nomina || 0, fill: "#dc2626" },
    { name: "Seg. Social", valor: cierre.egresos_seg_social || 0, fill: "#9f1239" },
  ];

  const tiposResumen = Object.values((reporte?.egresos || []).reduce((acc, row) => {
    const key = row.tipo_gasto || "OTRO";
    if (!acc[key]) acc[key] = { tipo: key, cantidad: 0, total: 0 };
    acc[key].cantidad += 1;
    acc[key].total += Number(row.valor || 0);
    return acc;
  }, {}))
    .sort((a, b) => b.total - a.total)
    .map((item) => ({
      ...item,
      porcentaje: cierre.total_egresos ? `${((item.total / cierre.total_egresos) * 100).toFixed(1)}%` : "0.0%",
    }));

  async function downloadReport() {
    await downloadExcelFile(`/api/export/reportes?mes=${month}&ano=${year}`, `Reporte_${month}_${year}.xlsx`, setError, notify);
  }

  async function handleToggleCierre() {
    const action = cierre.cerrado ? "reabrir" : "cerrar";
    const observacion = window.prompt(
      cierre.cerrado
        ? "Motivo para reabrir el período:"
        : "Observación de cierre del período:",
      ""
    );
    if (observacion === null) return;
    try {
      await request(`/api/cierres/${action}`, {
        method: "POST",
        body: JSON.stringify({ mes: month, ano: year, observacion }),
      });
      notify(cierre.cerrado ? "Período reabierto" : "Período cerrado", "success");
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page-view">
      <Toolbar title="Reportes y Cierre">
        <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
          {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
        </select>
        <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
          {years.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <TBtn tone={cierre.cerrado ? "red" : "blue"} onClick={handleToggleCierre}>
          {cierre.cerrado ? "Reabrir Mes" : "Cerrar Mes"}
        </TBtn>
        <TBtn tone="green" onClick={downloadReport}>Exportar Reporte</TBtn>
      </Toolbar>

      <div className="split-panels">
        <div className="panel">
          <h3 className="panel-title">Cierre Mensual Unificado</h3>
          <div className="summary-list">
            <div className="summary-row summary-strong"><span>Periodo</span><strong>{cierre.periodo || `${MONTH_NAMES[month - 1]} ${year}`}</strong></div>
            <div className="summary-row"><span>Estado</span><strong>{cierre.cerrado ? "Cerrado" : "Abierto"}</strong></div>
            <div className="summary-row summary-divider" />
            <div className="summary-row summary-green"><span>Ingresos</span><strong>{money(cierre.total_ingresos)}</strong></div>
            <div className="summary-row"><span>Egresos operativos</span><strong>{money(cierre.egresos_operativos)}</strong></div>
            <div className="summary-row"><span>Nómina empleados</span><strong>{money(cierre.egresos_nomina)}</strong></div>
            <div className="summary-row"><span>Seguridad social</span><strong>{money(cierre.egresos_seg_social)}</strong></div>
            <div className="summary-row"><span>Novedades deducción</span><strong>{money(cierre.novedades_deduccion)}</strong></div>
            <div className="summary-row summary-red"><span>Total egresos</span><strong>{money(cierre.total_egresos)}</strong></div>
            <div className="summary-row summary-divider" />
            <div className="summary-row"><span>Nómina integrada</span><strong>{money(cierre.nomina?.total_nomina_integrada)}</strong></div>
            <div className="summary-row"><span>Empleados</span><strong>{cierre.nomina?.empleados ?? 0}</strong></div>
            <div className="summary-row"><span>Novedades +</span><strong>{money(cierre.nomina?.total_novedades_devengado)}</strong></div>
            <div className="summary-row"><span>Novedades -</span><strong>{money(cierre.nomina?.total_novedades_deduccion)}</strong></div>
            <div className="summary-row summary-strong summary-result"><span>Resultado neto</span><strong>{money(cierre.resultado_neto)}</strong></div>
          </div>
        </div>

        <div className="panel">
          <h3 className="panel-title">Detalle por Naturaleza del gasto</h3>
          <DataTable
            columns={[
              { key: "tipo", label: "Naturaleza" },
              { key: "cantidad", label: "N° Registros" },
              { key: "total", label: "Total", render: (value) => money(value) },
              { key: "porcentaje", label: "%" },
            ]}
            rows={tiposResumen}
          />
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="Ingresos" value={money(cierre.total_ingresos)} tone="green" />
        <StatCard label="Egresos" value={money(cierre.total_egresos)} tone="red" />
        <StatCard label="Resultado neto" value={money(cierre.resultado_neto)} tone="blue" />
        <StatCard label="Nómina integrada" value={money(cierre.nomina?.total_nomina_integrada)} tone="slate" />
      </div>

      <div className="rpt-charts-grid">
        <div className="panel">
          <h3 className="panel-title">Ingresos vs Egresos</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={barData} margin={{ top: 8, right: 16, left: 16, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`} tick={{ fontSize: 11 }} width={60} />
              <Tooltip formatter={(value) => money(value)} />
              <Bar dataKey="valor" radius={[6, 6, 0, 0]}>
                {barData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="panel">
          <h3 className="panel-title">Ingresos por Fuente</h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  paddingAngle={3}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => money(value)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="rpt-no-data">Sin datos de ingresos para este período.</div>
          )}
        </div>
      </div>

      <div className="split-panels">
        <div className="panel">
          <h3 className="panel-title">Detalle de Egresos</h3>
          <DataTable
            columns={[
              { key: "fecha", label: "Fecha" },
              { key: "razon_social", label: "Proveedor" },
              { key: "tipo_gasto", label: "Naturaleza" },
              { key: "valor", label: "Valor", render: (value) => money(value) },
            ]}
            rows={reporte?.egresos || []}
          />
        </div>
        <div className="panel">
          <h3 className="panel-title">Detalle de Ingresos</h3>
          <DataTable
            columns={[
              { key: "fecha", label: "Fecha" },
              { key: "caja", label: "Caja", render: (value) => money(value) },
              { key: "bancos", label: "Bancos", render: (value) => money(value) },
              { key: "tarjeta_cr", label: "Tarjeta CR", render: (value) => money(value) },
            ]}
            rows={reporte?.ingresos || []}
          />
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Auditoría Reciente</h3>
        <DataTable
          columns={[
            { key: "created_at", label: "Fecha" },
            { key: "entidad", label: "Entidad" },
            { key: "accion", label: "Acción" },
            { key: "periodo", label: "Período" },
            { key: "detalle", label: "Detalle" },
          ]}
          rows={auditoria || []}
          maxHeight="300px"
        />
      </div>
    </div>
  );
}
