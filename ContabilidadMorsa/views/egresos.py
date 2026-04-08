import tkinter as tk
from tkinter import ttk, messagebox
import customtkinter as ctk
from datetime import datetime, date
from database import (AppValidationError, get_egresos, save_egreso, delete_egreso,
                      get_proveedores, get_tipos_gasto_distintos)
from ui_helpers import fit_tree_rows, fix_scrollframe, setup_toplevel, setup_treeview_style

MONTHS = {
    1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
    5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
    9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
}
MONTH_NAMES = [MONTHS[i] for i in range(1, 13)]

COLS = ('fecha', 'no_documento', 'razon_social', 'nit', 'valor', 'tipo_gasto', 'factura_electronica', 'observaciones')
COL_LABELS = ('Fecha', 'N° Doc', 'Proveedor / Razon Social', 'NIT', 'Valor', 'Naturaleza del gasto', 'Factura electrónica', 'Observaciones')
COL_WIDTHS = (90, 90, 240, 110, 110, 130, 130, 180)


def fmt(v):
    try:
        return f'$ {float(v):,.0f}'.replace(',', '.')
    except Exception:
        return str(v)


class EgresosView(ctk.CTkFrame):
    def __init__(self, parent):
        super().__init__(parent, fg_color='transparent')
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        now = datetime.now()
        self._mes = now.month
        self._ano = now.year

        self._build_toolbar()
        self._build_table()
        self.refresh()

    # ── Toolbar ──────────────────────────────────────────────────────────────

    def _build_toolbar(self):
        bar = ctk.CTkFrame(self, fg_color='white', corner_radius=12)
        bar.grid(row=0, column=0, sticky='ew', pady=(0, 12))

        ctk.CTkLabel(bar, text='Egresos', font=ctk.CTkFont(size=22, weight='bold'),
                     text_color='#1e3a5f').pack(side='left', padx=16, pady=12)

        # Right controls
        ctrl = ctk.CTkFrame(bar, fg_color='transparent')
        ctrl.pack(side='right', padx=12)

        # Search
        self._search_var = tk.StringVar()
        self._search_var.trace_add('write', lambda *_: self.refresh())
        ctk.CTkEntry(ctrl, textvariable=self._search_var,
                     placeholder_text='Buscar...', width=160, height=32).pack(
            side='left', padx=(0, 8))

        # Naturaleza filter
        tipos = ['Todos'] + get_tipos_gasto_distintos()
        self._tipo_var = tk.StringVar(value='Todos')
        tipo_cb = ctk.CTkComboBox(ctrl, values=tipos, variable=self._tipo_var,
                                   width=130, height=32, command=lambda *_: self.refresh())
        tipo_cb.pack(side='left', padx=(0, 8))

        # Month
        self._mes_cb = ctk.CTkComboBox(ctrl, values=MONTH_NAMES, width=130, height=32,
                                        command=self._on_period)
        self._mes_cb.set(MONTHS[self._mes])
        self._mes_cb.pack(side='left', padx=(0, 4))

        # Year
        self._ano_cb = ctk.CTkComboBox(ctrl, values=[str(y) for y in range(2023, 2030)],
                                        width=84, height=32, command=self._on_period)
        self._ano_cb.set(str(self._ano))
        self._ano_cb.pack(side='left', padx=(0, 12))

        # Buttons
        ctk.CTkButton(ctrl, text='+ Nuevo', width=90, height=32,
                      fg_color='#1e3a5f', hover_color='#2a5298',
                      command=self._new).pack(side='left', padx=(0, 6))
        ctk.CTkButton(ctrl, text='Editar', width=80, height=32,
                      fg_color='#2980b9', hover_color='#3498db',
                      command=self._edit).pack(side='left', padx=(0, 6))
        ctk.CTkButton(ctrl, text='Eliminar', width=80, height=32,
                      fg_color='#e74c3c', hover_color='#c0392b',
                      command=self._delete).pack(side='left')

    # ── Table ────────────────────────────────────────────────────────────────

    def _build_table(self):
        frame = ctk.CTkFrame(self, fg_color='white', corner_radius=12)
        frame.grid(row=1, column=0, sticky='nsew')
        frame.grid_columnconfigure(0, weight=1)

        setup_treeview_style('Morsa', heading_bg='#dbeafe', heading_fg='#1e3a5f', select_bg='#bfdbfe')

        self._tree = ttk.Treeview(frame, style='Morsa.Treeview',
                                   columns=COLS, show='headings', selectmode='browse')
        for col, lbl, w in zip(COLS, COL_LABELS, COL_WIDTHS):
            self._tree.heading(col, text=lbl)
            self._tree.column(col, width=w, minwidth=60)

        vsb = ttk.Scrollbar(frame, orient='vertical', command=self._tree.yview)
        hsb = ttk.Scrollbar(frame, orient='horizontal', command=self._tree.xview)
        self._tree.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)

        self._tree.grid(row=0, column=0, sticky='ew', padx=10, pady=10)
        vsb.grid(row=0, column=1, sticky='ns', pady=10)
        hsb.grid(row=1, column=0, sticky='ew', padx=10)

        self._tree.bind('<Double-1>', lambda _: self._edit())

        # Status bar
        self._status = ctk.CTkLabel(frame, text='', font=ctk.CTkFont(size=11),
                                     text_color='#666')
        self._status.grid(row=2, column=0, columnspan=2, sticky='w', padx=12, pady=(0, 6))

    # ── Data ─────────────────────────────────────────────────────────────────

    def _on_period(self, *_):
        self._mes = MONTH_NAMES.index(self._mes_cb.get()) + 1
        self._ano = int(self._ano_cb.get())
        self.refresh()

    def refresh(self):
        self._data = get_egresos(
            mes=self._mes, ano=self._ano,
            tipo=self._tipo_var.get(),
            search=self._search_var.get()
        )
        self._tree.delete(*self._tree.get_children())
        total = 0.0
        for i, eg in enumerate(self._data):
            tag = 'even' if i % 2 == 0 else 'odd'
            self._tree.insert('', 'end', iid=str(eg['id']), tags=(tag,),
                              values=(
                                  eg['fecha'],
                                  eg['no_documento'] or '',
                                  eg['razon_social'] or '',
                                  eg['nit'] or '',
                                  fmt(eg['valor']),
                                  eg['tipo_gasto'] or '',
                                  eg.get('factura_electronica', 'NO') or 'NO',
                                  eg['observaciones'] or '',
                              ))
            total += eg['valor'] or 0
        fit_tree_rows(self._tree, len(self._data), max_rows=16)
        self._tree.tag_configure('even', background='white', foreground='#1f2937')
        self._tree.tag_configure('odd', background='#f8fafc', foreground='#1f2937')
        self._status.configure(
            text=f'{len(self._data)} registros  |  Total: {fmt(total)}'
        )

    def _selected_id(self):
        sel = self._tree.selection()
        return int(sel[0]) if sel else None

    def _new(self):
        EgresosForm(self, None, self.refresh)

    def _edit(self):
        eid = self._selected_id()
        if eid is None:
            messagebox.showinfo('Aviso', 'Selecciona un egreso para editar.')
            return
        data = next((e for e in self._data if e['id'] == eid), None)
        if data:
            EgresosForm(self, data, self.refresh)

    def _delete(self):
        eid = self._selected_id()
        if eid is None:
            messagebox.showinfo('Aviso', 'Selecciona un egreso para eliminar.')
            return
        if messagebox.askyesno('Confirmar', '¿Eliminar este egreso?'):
            delete_egreso(eid)
            self.refresh()


# ── Form dialog ──────────────────────────────────────────────────────────────

class EgresosForm(ctk.CTkToplevel):
    def __init__(self, parent, data, on_save):
        super().__init__(parent)
        self.on_save = on_save
        self.editing_id = data['id'] if data else None
        self._source_module = data.get('source_module', '') if data else ''
        self._source_ref = data.get('source_ref', '') if data else ''
        self._source_period = data.get('source_period', '') if data else ''

        self.title('Nuevo Egreso' if not data else 'Editar Egreso')
        self.geometry('660x720')
        self.minsize(620, 560)
        self.resizable(True, True)
        self.transient(parent.winfo_toplevel())
        self.grab_set()

        self._proveedores = get_proveedores()
        self._prov_names = [p['razon_social'] for p in self._proveedores]
        self._tipos = get_tipos_gasto_distintos()

        self._build(data or {})
        self.after(50, self._present)

    def _present(self):
        self.update_idletasks()
        root = self.master.winfo_toplevel()
        x = root.winfo_rootx() + max((root.winfo_width() - self.winfo_width()) // 2, 40)
        y = root.winfo_rooty() + max((root.winfo_height() - self.winfo_height()) // 2, 40)
        self.geometry(f'+{x}+{y}')
        self.lift()
        self.focus_force()

    def _build(self, d):
        setup_toplevel(self)
        field_pad = {'padx': 24, 'pady': 4}
        main = ctk.CTkScrollableFrame(self, fg_color='white')
        main.pack(fill='both', expand=True)
        fix_scrollframe(main)

        ctk.CTkLabel(main, text='Nuevo Egreso' if not self.editing_id else 'Editar Egreso',
                     font=ctk.CTkFont(size=18, weight='bold'),
                     text_color='#1e3a5f').pack(anchor='w', padx=24, pady=(16, 8))

        def lbl(text):
            ctk.CTkLabel(main, text=text, font=ctk.CTkFont(size=12),
                         text_color='#555').pack(anchor='w', padx=24, pady=(8, 0))

        # Fecha
        lbl('Fecha (YYYY-MM-DD)')
        self._fecha = ctk.CTkEntry(main, height=36, placeholder_text='2025-03-01')
        self._fecha.pack(fill='x', **field_pad)
        self._fecha.insert(0, d.get('fecha', date.today().strftime('%Y-%m-%d')))

        # N° Documento
        lbl('N° Documento')
        self._ndoc = ctk.CTkEntry(main, height=36)
        self._ndoc.pack(fill='x', **field_pad)
        self._ndoc.insert(0, d.get('no_documento', '') or '')

        # Proveedor autocomplete
        lbl('Proveedor / Razon Social')
        self._prov_var = tk.StringVar(value=d.get('razon_social', '') or '')
        self._prov_cb = ctk.CTkComboBox(main, values=self._prov_names,
                                         variable=self._prov_var, height=36,
                                         command=self._on_prov_select)
        self._prov_cb.pack(fill='x', **field_pad)
        self._prov_var.trace_add('write', self._filter_provs)

        # NIT (readonly, auto-filled)
        lbl('NIT')
        self._nit = ctk.CTkEntry(main, height=36)
        self._nit.pack(fill='x', **field_pad)
        self._nit.insert(0, d.get('nit', '') or '')

        # Valor
        lbl('Valor ($)')
        self._valor = ctk.CTkEntry(main, height=36, placeholder_text='0')
        self._valor.pack(fill='x', **field_pad)
        if d.get('valor'):
            self._valor.insert(0, str(d['valor']))

        # Naturaleza del gasto
        lbl('Naturaleza del gasto')
        self._tipo_var = tk.StringVar(value=d.get('tipo_gasto', 'COSTO'))
        self._tipo_cb = ctk.CTkComboBox(main, values=self._tipos,
                                         variable=self._tipo_var, height=36)
        self._tipo_cb.pack(fill='x', **field_pad)

        # Canal de pago
        lbl('Canal de pago')
        self._canal_var = tk.StringVar(value=d.get('canal_pago', 'Otro') or 'Otro')
        ctk.CTkComboBox(main, values=['Caja', 'Bancos', 'Tarjeta CR', 'Otro'],
                        variable=self._canal_var, height=36).pack(fill='x', **field_pad)

        # Factura electronica
        lbl('Factura electrónica')
        self._factura_var = tk.StringVar(value=d.get('factura_electronica', 'NO') or 'NO')
        ctk.CTkComboBox(main, values=['SI', 'NO'], variable=self._factura_var, height=36).pack(
            fill='x', **field_pad
        )

        # Observaciones
        lbl('Observaciones')
        self._obs = ctk.CTkEntry(main, height=36)
        self._obs.pack(fill='x', **field_pad)
        self._obs.insert(0, d.get('observaciones', '') or '')

        # Buttons
        btn_frame = ctk.CTkFrame(main, fg_color='transparent')
        btn_frame.pack(fill='x', padx=24, pady=(20, 16))

        ctk.CTkButton(btn_frame, text='Cancelar', width=100, height=36,
                      fg_color='#ccc', text_color='#333', hover_color='#bbb',
                      command=self.destroy).pack(side='right', padx=(8, 0))
        ctk.CTkButton(btn_frame, text='Guardar', width=120, height=36,
                      fg_color='#1e3a5f', hover_color='#2a5298',
                      command=self._save).pack(side='right')

    def _filter_provs(self, *_):
        query = self._prov_var.get().lower()
        filtered = [p for p in self._prov_names if query in p.lower()]
        self._prov_cb.configure(values=filtered[:40])

    def _on_prov_select(self, name):
        prov = next((p for p in self._proveedores if p['razon_social'] == name), None)
        if prov:
            self._nit.delete(0, 'end')
            self._nit.insert(0, prov.get('nit', '') or '')

    def _save(self):
        fecha = self._fecha.get().strip()
        razon = self._prov_var.get().strip()
        valor_str = self._valor.get().strip().replace('.', '').replace(',', '').replace('$', '').replace(' ', '')

        if not fecha or not razon or not valor_str:
            messagebox.showerror('Error', 'Fecha, proveedor y valor son obligatorios.')
            return
        try:
            valor = float(valor_str)
        except ValueError:
            messagebox.showerror('Error', 'El valor debe ser un numero.')
            return

        prov = next((p for p in self._proveedores if p['razon_social'] == razon), None)
        data = {
            'fecha': fecha,
            'no_documento': self._ndoc.get().strip(),
            'consecutivo': '',
            'proveedor_id': prov['id'] if prov else None,
            'razon_social': razon,
            'nit': self._nit.get().strip(),
            'valor': valor,
            'tipo_gasto': self._tipo_var.get().strip().upper(),
            'canal_pago': self._canal_var.get().strip(),
            'factura_electronica': self._factura_var.get().strip().upper(),
            'observaciones': self._obs.get().strip(),
            'source_module': self._source_module,
            'source_ref': self._source_ref,
            'source_period': self._source_period,
        }
        try:
            save_egreso(data, self.editing_id)
        except AppValidationError as exc:
            messagebox.showerror('Error', str(exc))
            return
        self.on_save()
        self.destroy()
