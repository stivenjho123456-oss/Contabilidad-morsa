export const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "caja", label: "Caja" },
  { key: "egresos", label: "Egresos" },
  { key: "ingresos", label: "Ingresos" },
  { key: "nomina", label: "Nomina" },
  { key: "proveedores", label: "Proveedores y Base" },
  { key: "reportes", label: "Reportes" },
];

export const TIPO_COLORS = [
  "#e74c3c", "#e67e22", "#f39c12", "#2ecc71", "#3498db",
  "#9b59b6", "#1abc9c", "#e91e63", "#ff5722", "#607d8b",
];

export const EMPTY_SYSTEM_SUMMARY = {
  counts: {},
  db_health: { ok: true, integrity: "ok", exists: true, size_bytes: 0, backend: "postgresql" },
  deployment_mode: "cloud",
  storage_mode: "database",
  log_file: "",
};

export const EMPTY_NOMINA = {
  periodos: [],
  stats: {},
  workflow: { steps: [] },
  resumen: [],
  asistencia: [],
  asistencia_resumen: [],
  seg_social: [],
  novedades: [],
};
