import tkinter as tk
from tkinter import ttk, messagebox
import customtkinter as ctk
from database import AppValidationError, get_proveedores, save_proveedor, delete_proveedor
from ui_helpers import fit_tree_rows, fix_scrollframe, setup_toplevel, setup_treeview_style

COLS = ('razon_social', 'nit', 'telefono', 'correo')
COL_LABELS = ('Razon Social', 'NIT', 'Telefono', 'Correo')
COL_WIDTHS = (320, 140, 150, 240)


class ProveedoresView(ctk.CTkFrame):
    def __init__(self, parent):
        super().__init__(parent, fg_color='transparent')
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)
        self._build_toolbar()
        self._build_table()
        self.refresh()

    def _build_toolbar(self):
        bar = ctk.CTkFrame(self, fg_color='white', corner_radius=12)
        bar.grid(row=0, column=0, sticky='ew', pady=(0, 12))
        bar.grid_columnconfigure(0, weight=1)

        title = ctk.CTkFrame(bar, fg_color='transparent')
        title.pack(side='left', padx=16, pady=12)
        ctk.CTkLabel(title, text='Proveedores / Base de Datos',
                     font=ctk.CTkFont(size=22, weight='bold'),
                     text_color='#1e3a5f').pack(anchor='w')
        ctk.CTkLabel(
            title,
            text='Aqui puedes crear, editar y buscar proveedores. Usa el botón "+ Nuevo" para registrar uno.',
            font=ctk.CTkFont(size=12),
            text_color='#64748b'
        ).pack(anchor='w', pady=(2, 0))

        ctrl = ctk.CTkFrame(bar, fg_color='transparent')
        ctrl.pack(side='right', padx=12)

        self._search_var = tk.StringVar()
        self._search_var.trace_add('write', lambda *_: self.refresh())
        ctk.CTkEntry(ctrl, textvariable=self._search_var,
                     placeholder_text='Buscar...', width=200, height=32).pack(
            side='left', padx=(0, 12))

        ctk.CTkButton(ctrl, text='+ Nuevo', width=90, height=32,
                      fg_color='#1e3a5f', hover_color='#2a5298',
                      command=self._new).pack(side='left', padx=(0, 6))
        ctk.CTkButton(ctrl, text='Editar', width=80, height=32,
                      fg_color='#2980b9', hover_color='#3498db',
                      command=self._edit).pack(side='left', padx=(0, 6))
        ctk.CTkButton(ctrl, text='Eliminar', width=80, height=32,
                      fg_color='#e74c3c', hover_color='#c0392b',
                      command=self._delete).pack(side='left')

    def _build_table(self):
        frame = ctk.CTkFrame(self, fg_color='white', corner_radius=12)
        frame.grid(row=1, column=0, sticky='nsew')
        frame.grid_columnconfigure(0, weight=1)

        setup_treeview_style('Prov', heading_bg='#e2e8f0', heading_fg='#334155', select_bg='#dbeafe')

        self._tree = ttk.Treeview(frame, style='Prov.Treeview',
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

        self._status = ctk.CTkLabel(frame, text='', font=ctk.CTkFont(size=11),
                                     text_color='#666')
        self._status.grid(row=2, column=0, columnspan=2, sticky='w', padx=12, pady=(0, 6))

    def refresh(self):
        self._data = get_proveedores(self._search_var.get())
        self._tree.delete(*self._tree.get_children())
        for i, p in enumerate(self._data):
            tag = 'even' if i % 2 == 0 else 'odd'
            self._tree.insert('', 'end', iid=str(p['id']), tags=(tag,),
                              values=(p['razon_social'], p['nit'] or '',
                                      p['telefono'] or '', p['correo'] or ''))
        fit_tree_rows(self._tree, len(self._data), max_rows=18)
        self._tree.tag_configure('even', background='white', foreground='#1f2937')
        self._tree.tag_configure('odd', background='#f8f9fa', foreground='#1f2937')
        self._status.configure(text=f'{len(self._data)} proveedores')

    def _selected_id(self):
        sel = self._tree.selection()
        return int(sel[0]) if sel else None

    def _new(self):
        ProveedorForm(self, None, self.refresh)

    def _edit(self):
        pid = self._selected_id()
        if pid is None:
            messagebox.showinfo('Aviso', 'Selecciona un proveedor para editar.')
            return
        data = next((p for p in self._data if p['id'] == pid), None)
        if data:
            ProveedorForm(self, data, self.refresh)

    def _delete(self):
        pid = self._selected_id()
        if pid is None:
            messagebox.showinfo('Aviso', 'Selecciona un proveedor para eliminar.')
            return
        if messagebox.askyesno('Confirmar', '¿Eliminar este proveedor?'):
            try:
                delete_proveedor(pid)
            except AppValidationError as exc:
                messagebox.showerror('Error', str(exc))
                return
            self.refresh()


class ProveedorForm(ctk.CTkToplevel):
    def __init__(self, parent, data, on_save):
        super().__init__(parent)
        self.on_save = on_save
        self.editing_id = data['id'] if data else None

        self.title('Nuevo Proveedor' if not data else 'Editar Proveedor')
        self.geometry('520x600')
        self.resizable(False, False)
        self.grab_set()
        self._build(data or {})

    def _build(self, d):
        setup_toplevel(self)
        main = ctk.CTkScrollableFrame(self, fg_color='white')
        main.pack(fill='both', expand=True)
        fix_scrollframe(main)

        ctk.CTkLabel(main, text='Datos del Proveedor',
                     font=ctk.CTkFont(size=17, weight='bold'),
                     text_color='#1e3a5f').pack(anchor='w', padx=24, pady=(16, 8))

        pad = {'padx': 24, 'pady': (2, 0)}

        def field(label, key, placeholder=''):
            ctk.CTkLabel(main, text=label, font=ctk.CTkFont(size=12),
                         text_color='#555').pack(anchor='w', padx=24, pady=(10, 0))
            e = ctk.CTkEntry(main, height=36, placeholder_text=placeholder)
            e.pack(fill='x', **pad)
            e.insert(0, d.get(key, '') or '')
            return e

        self._razon    = field('Razon Social *', 'razon_social')
        self._nit      = field('NIT', 'nit')
        self._pnombre  = field('Primer Nombre', 'primer_nombre')
        self._snombre  = field('Segundo Nombre', 'segundo_nombre')
        self._papell   = field('Primer Apellido', 'primer_apellido')
        self._sapell   = field('Segundo Apellido', 'segundo_apellido')
        self._dir      = field('Direccion', 'direccion')
        self._tel      = field('Telefono', 'telefono')
        self._correo   = field('Correo', 'correo')

        btn_f = ctk.CTkFrame(main, fg_color='transparent')
        btn_f.pack(fill='x', padx=24, pady=(20, 16))
        ctk.CTkButton(btn_f, text='Cancelar', width=100, height=36,
                      fg_color='#ccc', text_color='#333', hover_color='#bbb',
                      command=self.destroy).pack(side='right', padx=(8, 0))
        ctk.CTkButton(btn_f, text='Guardar', width=110, height=36,
                      fg_color='#1e3a5f', hover_color='#2a5298',
                      command=self._save).pack(side='right')

    def _save(self):
        data = {
            'razon_social':    self._razon.get().strip(),
            'nit':             self._nit.get().strip(),
            'primer_nombre':   self._pnombre.get().strip(),
            'segundo_nombre':  self._snombre.get().strip(),
            'primer_apellido': self._papell.get().strip(),
            'segundo_apellido':self._sapell.get().strip(),
            'direccion':       self._dir.get().strip(),
            'telefono':        self._tel.get().strip(),
            'correo':          self._correo.get().strip(),
            'tipo':            '',
        }
        try:
            save_proveedor(data, self.editing_id)
        except AppValidationError as exc:
            messagebox.showerror('Error', str(exc))
            return
        self.on_save()
        self.destroy()
