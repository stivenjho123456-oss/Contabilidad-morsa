import { useDeferredValue, useState } from "react";
import { downloadExcelFile, request } from "../lib/api";
import { DataTable, Field, MetricStrip, Modal, TBtn, Toolbar } from "../components/ui";

const EMPTY_PROV = {
  razon_social: "",
  nit: "",
  primer_nombre: "",
  segundo_nombre: "",
  primer_apellido: "",
  segundo_apellido: "",
  direccion: "",
  telefono: "",
  correo: "",
};

function ProveedorModal({ data, onClose, onSaved, setError, notify }) {
  const [form, setForm] = useState({ ...EMPTY_PROV, ...(data || {}) });
  const [saving, setSaving] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    try {
      setSaving(true);
      if (data?.id) {
        await request(`/api/proveedores/${data.id}`, { method: "PUT", body: JSON.stringify(form) });
      } else {
        await request("/api/proveedores", { method: "POST", body: JSON.stringify(form) });
      }
      onSaved();
      notify(data?.id ? "Proveedor actualizado" : "Proveedor creado", "success");
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={data?.id ? "Editar Proveedor" : "Nuevo Proveedor"} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <Field label="Razón Social *"><input required value={form.razon_social} onChange={set("razon_social")} /></Field>
        <Field label="NIT"><input value={form.nit} onChange={set("nit")} /></Field>
        <Field label="Primer Nombre"><input value={form.primer_nombre} onChange={set("primer_nombre")} /></Field>
        <Field label="Segundo Nombre"><input value={form.segundo_nombre} onChange={set("segundo_nombre")} /></Field>
        <Field label="Primer Apellido"><input value={form.primer_apellido} onChange={set("primer_apellido")} /></Field>
        <Field label="Segundo Apellido"><input value={form.segundo_apellido} onChange={set("segundo_apellido")} /></Field>
        <Field label="Dirección"><input value={form.direccion} onChange={set("direccion")} /></Field>
        <Field label="Teléfono"><input value={form.telefono} onChange={set("telefono")} /></Field>
        <Field label="Correo"><input type="email" value={form.correo} onChange={set("correo")} /></Field>
        <div className="modal-footer">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn-save" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ProveedoresView({ proveedores, reload, setError, notify }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null);
  const deferredSearch = useDeferredValue(search);

  const filtered = proveedores.filter((proveedor) =>
    `${proveedor.razon_social} ${proveedor.nit}`.toLowerCase().includes(deferredSearch.toLowerCase())
  );

  async function handleDelete() {
    if (!selected) {
      alert("Selecciona un proveedor para eliminar.");
      return;
    }
    if (!window.confirm("¿Eliminar este proveedor?")) return;
    try {
      await request(`/api/proveedores/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      reload();
      notify("Proveedor eliminado", "success");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleExport() {
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    await downloadExcelFile(`/api/export/proveedores${query}`, "Proveedores.xlsx", setError, notify);
  }

  return (
    <div className="page-view">
      <Toolbar
        title="Proveedores / Base de Datos"
        subtitle="Aquí puedes crear, editar y buscar proveedores. Usa el botón '+ Nuevo' para registrar uno."
      >
        <input
          className="search-input"
          placeholder="Buscar..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <TBtn tone="green" onClick={handleExport}>Exportar Excel</TBtn>
        <TBtn tone="navy" onClick={() => setModal("new")}>+ Nuevo</TBtn>
        <TBtn
          tone="blue"
          onClick={() => {
            if (!selected) {
              alert("Selecciona un proveedor para editar.");
              return;
            }
            setModal("edit");
          }}
        >
          Editar
        </TBtn>
        <TBtn tone="red" onClick={handleDelete}>Eliminar</TBtn>
      </Toolbar>

      <div className="panel">
        <MetricStrip
          items={[
            { label: "Registros visibles", value: filtered.length },
            { label: "Base total", value: proveedores.length },
          ]}
        />
        <p className="status-text">{filtered.length} proveedores</p>
        <DataTable
          selectedId={selected?.id}
          onSelect={setSelected}
          columns={[
            { key: "razon_social", label: "Razón Social" },
            { key: "nit", label: "NIT" },
            { key: "telefono", label: "Teléfono" },
            { key: "correo", label: "Correo" },
          ]}
          rows={filtered}
          maxHeight="calc(100vh - 300px)"
        />
      </div>

      {modal === "new" && <ProveedorModal data={null} onClose={() => setModal(null)} onSaved={reload} setError={setError} notify={notify} />}
      {modal === "edit" && <ProveedorModal data={selected} onClose={() => setModal(null)} onSaved={reload} setError={setError} notify={notify} />}
    </div>
  );
}
