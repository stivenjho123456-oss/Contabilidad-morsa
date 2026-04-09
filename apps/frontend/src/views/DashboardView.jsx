import { MONTH_NAMES, TIPO_COLORS } from "../lib/constants";
import { money } from "../lib/format";
import { StatCard, TBtn, Toolbar } from "../components/ui";

export function DashboardView({ year, month, setYear, setMonth, years, navigate, dashboard }) {
  const stats = dashboard?.stats;

  return (
    <div className="page-view">
      <Toolbar title="Dashboard">
        <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
          {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
        </select>
        <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
          {years.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </Toolbar>

      <div className="quick-banner">
        <div className="quick-text">
          <strong>Accesos rápidos</strong>
          <p>Si quieres crear un proveedor nuevo, entra por "Proveedores y Base" o usa el botón directo de abajo.</p>
        </div>
        <div className="quick-btns">
          <TBtn tone="green" onClick={() => navigate("proveedores")}>Nuevo Proveedor</TBtn>
          <TBtn tone="navy" onClick={() => navigate("egresos")}>Registrar Egreso</TBtn>
          <TBtn tone="blue" onClick={() => navigate("ingresos")}>Registrar Ingreso</TBtn>
          <TBtn tone="purple" onClick={() => navigate("reportes")}>Ver Cierre Mensual</TBtn>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="💰  Total Ingresos" value={money(stats?.total_ingresos)} tone="green" />
        <StatCard label="💸  Total Egresos" value={money(stats?.total_egresos)} tone="red" />
        <StatCard
          label="📈  Utilidad Bruta"
          value={money(stats?.utilidad)}
          tone={(stats?.utilidad ?? 0) >= 0 ? "blue" : "red"}
        />
      </div>

      <div className="split-panels">
        <div className="panel">
          <h3 className="panel-title">Egresos por Naturaleza</h3>
          <div className="tipo-list">
            {(stats?.egresos_by_tipo || []).map(([tipo, total], index) => {
              const pct = stats.total_egresos
                ? ((total / stats.total_egresos) * 100).toFixed(1)
                : "0.0";
              return (
                <div key={tipo} className="tipo-row">
                  <span className="tipo-dot" style={{ color: TIPO_COLORS[index % TIPO_COLORS.length] }}>●</span>
                  <span className="tipo-name">{tipo || "—"}</span>
                  <span className="tipo-val">{money(total)}  ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <h3 className="panel-title">Últimos Egresos</h3>
          <div className="recent-list">
            {(stats?.recent_egresos || []).map((egreso, index) => (
              <div key={index} className="recent-row">
                <span className="recent-date">{egreso.fecha}</span>
                <span className="recent-name">{(egreso.razon_social || "").slice(0, 28)}</span>
                <span className="recent-val">{money(egreso.valor)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
