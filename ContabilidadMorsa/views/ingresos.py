import tkinter as tk
from tkinter import ttk, messagebox
import customtkinter as ctk
from datetime import datetime, date
from database import AppValidationError, get_ingresos, save_ingreso, delete_ingreso
from ui_helpers import fit_tree_rows, setup_toplevel, setup_treeview_style

MONTHS = {
    1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
    5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
    9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
}
MONTH_NAMES = [MONTHS[i] for i in range(1, 13)]

COLS = ('fecha', 'caja', 'bancos', 'tarjeta_cr', 'total')
COL_LABELS = ('Fecha', 'Caja', 'Bancos', 'Tarjeta CR', 'Total Dia')
COL_WIDTHS = (110, 140, 140, 140, 140)


def fmt(v):
    try:
        return f'$ {float(v):,.0f}'.replace(',', '.')
    except Exception:
        return '$ 0'


class IngresosView(ctk.CTkFrame):
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

    def _build_toolbar(self):
        bar = ctk.CTkFrame(self, fg_color='white', corner_radius=12)
        bar.grid(row=0, column=0, sticky='ew', pady=(0, 12))

        ctk.CTkLabel(bar, text='Ingresos', font=ctk.CTkFont(size=22, weight='bold'),
                     text_color='#1e3a5f').pack(side='left', padx=16, pady=12)

        ctrl = ctk.CTkFrame(bar, fg_color='transparent')
        ctrl.pack(side='right', padx=12)

        self._mes_cb = ctk.CTkComboBox(ctrl, values=MONTH_NAMES, width=130, height=32,
                                        command=self._on_period)
        self._mes_cb.set(MONTHS[self._mes])
        self._mes_cb.pack(side='left', padx=(0, 4))

        self._ano_cb = ctk.CTkComboBox(ctrl, values=[str(y) for y in range(2023, 2030)],
                                        width=84, height=32, command=self._on_period)
        self._ano_cb.set(str(self._ano))
        self._ano_cb.pack(side='left', padx=(0, 12))

        ctk.CTkButton(ctrl, text='+ Nuevo', width=90, height=32,
                      fg_color='#27ae60', hover_color='#219a52',
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

        setup_treeview_style('Ing', heading_bg='#dcfce7', heading_fg='#166534', select_bg='#d1fae5')

        self._tree = ttk.Treeview(frame, style='Ing.Treeview',
                                   columns=COLS, show='headings', selectmode='browse')
        for col, lbl, w in zip(COLS, COL_LABELS, COL_WIDTHS):
            self._tree.heading(col, text=lbl)
            self._tree.column(col, width=w, minwidth=60, anchor='center')

        vsb = ttk.Scrollbar(frame, orient='vertical', command=self._tree.yview)
        self._tree.configure(yscrollcommand=vsb.set)
        self._tree.grid(row=0, column=0, sticky='ew', padx=10, pady=10)
        vsb.grid(row=0, column=1, sticky='ns', pady=10)

        self._tree.bind('<Double-1>', lambda _: self._edit())

        self._status = ctk.CTkLabel(frame, text='', font=ctk.CTkFont(size=11),
                                     text_color='#666')
        self._status.grid(row=1, column=0, columnspan=2, sticky='w', padx=12, pady=(0, 6))

    def _on_period(self, *_):
        self._mes = MONTH_NAMES.index(self._mes_cb.get()) + 1
        self._ano = int(self._ano_cb.get())
        self.refresh()

    def refresh(self):
        self._data = get_ingresos(mes=self._mes, ano=self._ano)
        self._tree.delete(*self._tree.get_children())
        total_caja = total_bancos = total_tarjeta = 0.0
        for i, ing in enumerate(self._data):
            tag = 'even' if i % 2 == 0 else 'odd'
            t = (ing['caja'] or 0) + (ing['bancos'] or 0) + (ing['tarjeta_cr'] or 0)
            self._tree.insert('', 'end', iid=str(ing['id']), tags=(tag,),
                              values=(ing['fecha'], fmt(ing['caja']),
                                      fmt(ing['bancos']), fmt(ing['tarjeta_cr']), fmt(t)))
            total_caja    += ing['caja'] or 0
            total_bancos  += ing['bancos'] or 0
            total_tarjeta += ing['tarjeta_cr'] or 0

        fit_tree_rows(self._tree, len(self._data), max_rows=14)
        self._tree.tag_configure('even', background='white', foreground='#1f2937')
        self._tree.tag_configure('odd', background='#f0fdf4', foreground='#1f2937')

        gran_total = total_caja + total_bancos + total_tarjeta
        self._status.configure(
            text=(f'{len(self._data)} dias  |  Caja: {fmt(total_caja)}  '
                  f'Bancos: {fmt(total_bancos)}  Tarjeta: {fmt(total_tarjeta)}  '
                  f'TOTAL: {fmt(gran_total)}')
        )

    def _selected_id(self):
        sel = self._tree.selection()
        return int(sel[0]) if sel else None

    def _new(self):
        IngresosForm(self, None, self.refresh)

    def _edit(self):
        iid = self._selected_id()
        if iid is None:
            messagebox.showinfo('Aviso', 'Selecciona un registro para editar.')
            return
        data = next((d for d in self._data if d['id'] == iid), None)
        if data:
            IngresosForm(self, data, self.refresh)

    def _delete(self):
        iid = self._selected_id()
        if iid is None:
            messagebox.showinfo('Aviso', 'Selecciona un registro para eliminar.')
            return
        if messagebox.askyesno('Confirmar', '¿Eliminar este ingreso?'):
            delete_ingreso(iid)
            self.refresh()


class IngresosForm(ctk.CTkToplevel):
    def __init__(self, parent, data, on_save):
        super().__init__(parent)
        self.on_save = on_save
        self.editing_id = data['id'] if data else None

        self.title('Nuevo Ingreso' if not data else 'Editar Ingreso')
        self.geometry('440x400')
        self.resizable(False, False)
        self.transient(parent.winfo_toplevel())
        self._build(data or {})
        self.after(100, self._activate)

    def _build(self, d):
        setup_toplevel(self)
        # Botones anclados al fondo — se empaquetan PRIMERO para que nunca queden cortados
        btn_f = ctk.CTkFrame(self, fg_color='white')
        btn_f.pack(side='bottom', fill='x', padx=24, pady=(0, 20))
        ctk.CTkButton(btn_f, text='Cancelar', width=100, height=36,
                      fg_color='#ccc', text_color='#333', hover_color='#bbb',
                      command=self.destroy).pack(side='right', padx=(8, 0))
        ctk.CTkButton(btn_f, text='Guardar', width=110, height=36,
                      fg_color='#27ae60', hover_color='#219a52',
                      command=self._save).pack(side='right')

        # Contenido
        main = ctk.CTkFrame(self, fg_color='white')
        main.pack(fill='both', expand=True, padx=24, pady=(24, 4))

        ctk.CTkLabel(main, text='Registro de Ingresos',
                     font=ctk.CTkFont(size=17, weight='bold'),
                     text_color='#1e3a5f').pack(anchor='w', pady=(0, 8))

        def row(label, default=''):
            ctk.CTkLabel(main, text=label, font=ctk.CTkFont(size=12),
                         text_color='#555').pack(anchor='w', pady=(6, 0))
            e = ctk.CTkEntry(main, height=36)
            e.pack(fill='x')
            e.insert(0, default)
            return e

        self._fecha   = row('Fecha (YYYY-MM-DD)', d.get('fecha', date.today().strftime('%Y-%m-%d')))
        self._caja    = row('Caja ($)',       str(int(d['caja']))       if d.get('caja')       else '')
        self._bancos  = row('Bancos ($)',     str(int(d['bancos']))     if d.get('bancos')     else '')
        self._tarjeta = row('Tarjeta CR ($)', str(int(d['tarjeta_cr'])) if d.get('tarjeta_cr') else '')

    def _activate(self):
        self.grab_set()
        self.focus_force()

    def _parse(self, entry):
        raw = entry.get().strip().replace('.', '').replace(',', '').replace('$', '').replace(' ', '')
        return float(raw) if raw else 0.0

    def _save(self):
        fecha = self._fecha.get().strip()
        if not fecha:
            messagebox.showerror('Error', 'La fecha es obligatoria.')
            return
        try:
            data = {
                'fecha': fecha,
                'caja': self._parse(self._caja),
                'bancos': self._parse(self._bancos),
                'tarjeta_cr': self._parse(self._tarjeta),
            }
        except ValueError:
            messagebox.showerror('Error', 'Los valores deben ser numericos.')
            return
        try:
            save_ingreso(data, self.editing_id)
        except AppValidationError as exc:
            messagebox.showerror('Error', str(exc))
            return
        self.destroy()
        self.on_save()
