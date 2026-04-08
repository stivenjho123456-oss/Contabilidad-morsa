import tkinter as tk
from tkinter import ttk, messagebox
import customtkinter as ctk
from datetime import datetime, date

from database import (
    AppValidationError,
    calcular_movimientos_caja,
    delete_cuadre_caja,
    get_cuadres_caja,
    get_cuadre_caja_by_fecha,
    get_saldo_inicial_sugerido,
    save_cuadre_caja,
)
from ui_helpers import fit_tree_rows, setup_toplevel, setup_treeview_style

MONTHS = {
    1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
    5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
    9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
}
MONTH_NAMES = [MONTHS[i] for i in range(1, 13)]

COLS = ('fecha', 'saldo_inicial', 'ingresos_caja', 'egresos_caja',
        'saldo_esperado', 'saldo_real', 'diferencia', 'estado')
COL_LABELS = ('Fecha', 'Saldo Inicial', 'Ingresos Caja', 'Egresos Caja',
              'Saldo Esperado', 'Saldo Real', 'Diferencia', 'Estado')
COL_WIDTHS = (100, 120, 120, 120, 130, 120, 110, 90)


def fmt(v):
    try:
        return f'$ {float(v):,.0f}'.replace(',', '.')
    except Exception:
        return '$ 0'


def fmt_dif(v):
    """Formatea diferencia con signo."""
    try:
        val = float(v)
        sign = '+' if val >= 0 else ''
        return f'{sign}$ {val:,.0f}'.replace(',', '.')
    except Exception:
        return '—'


class CajaView(ctk.CTkFrame):
    def __init__(self, parent):
        super().__init__(parent, fg_color='transparent')
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(2, weight=1)

        now = datetime.now()
        self._mes = now.month
        self._ano = now.year

        self._build_toolbar()
        self._build_cuadre_hoy()
        self._build_table()
        self.refresh()

    # ── Toolbar ──────────────────────────────────────────────────────────────

    def _build_toolbar(self):
        bar = ctk.CTkFrame(self, fg_color='white', corner_radius=12)
        bar.grid(row=0, column=0, sticky='ew', pady=(0, 10))

        ctk.CTkLabel(bar, text='Cuadre de Caja', font=ctk.CTkFont(size=22, weight='bold'),
                     text_color='#1e3a5f').pack(side='left', padx=16, pady=12)

        ctrl = ctk.CTkFrame(bar, fg_color='transparent')
        ctrl.pack(side='right', padx=12)

        self._mes_cb = ctk.CTkComboBox(ctrl, values=MONTH_NAMES, width=130, height=32,
                                        command=self._on_period)
        self._mes_cb.set(MONTHS[self._mes])
        self._mes_cb.pack(side='left', padx=(0, 4))

        self._ano_cb = ctk.CTkComboBox(ctrl, values=[str(y) for y in range(2023, 2031)],
                                        width=84, height=32, command=self._on_period)
        self._ano_cb.set(str(self._ano))
        self._ano_cb.pack(side='left', padx=(0, 12))

        ctk.CTkButton(ctrl, text='+ Cuadrar Día', width=110, height=32,
                      fg_color='#1e3a5f', hover_color='#2a5298',
                      command=self._new).pack(side='left', padx=(0, 6))
        ctk.CTkButton(ctrl, text='Editar', width=80, height=32,
                      fg_color='#2980b9', hover_color='#3498db',
                      command=self._edit).pack(side='left', padx=(0, 6))
        ctk.CTkButton(ctrl, text='Eliminar', width=80, height=32,
                      fg_color='#e74c3c', hover_color='#c0392b',
                      command=self._delete).pack(side='left')

    # ── Panel cuadre de hoy ───────────────────────────────────────────────────

    def _build_cuadre_hoy(self):
        panel = ctk.CTkFrame(self, fg_color='white', corner_radius=12)
        panel.grid(row=1, column=0, sticky='ew', pady=(0, 10))
        panel.grid_columnconfigure((0, 1, 2, 3, 4, 5), weight=1)

        today = date.today().strftime('%Y-%m-%d')
        ctk.CTkLabel(panel, text=f'Hoy — {today}',
                     font=ctk.CTkFont(size=13, weight='bold'),
                     text_color='#1e3a5f').grid(row=0, column=0, columnspan=6,
                                                sticky='w', padx=16, pady=(12, 6))

        def metric(col, label, var, color='#1f2937'):
            f = ctk.CTkFrame(panel, fg_color='#f8fafc', corner_radius=8)
            f.grid(row=1, column=col, sticky='nsew', padx=8, pady=(0, 12))
            ctk.CTkLabel(f, text=label, font=ctk.CTkFont(size=10),
                         text_color='#6b7280').pack(padx=12, pady=(8, 2))
            ctk.CTkLabel(f, textvariable=var, font=ctk.CTkFont(size=15, weight='bold'),
                         text_color=color).pack(padx=12, pady=(0, 8))

        self._hoy_inicial = tk.StringVar(value='$ 0')
        self._hoy_ingresos = tk.StringVar(value='$ 0')
        self._hoy_egresos = tk.StringVar(value='$ 0')
        self._hoy_esperado = tk.StringVar(value='$ 0')
        self._hoy_real = tk.StringVar(value='—')
        self._hoy_dif = tk.StringVar(value='—')

        metric(0, 'Saldo Inicial', self._hoy_inicial)
        metric(1, 'Ingresos Caja', self._hoy_ingresos, '#16a34a')
        metric(2, 'Egresos Caja', self._hoy_egresos, '#dc2626')
        metric(3, 'Saldo Esperado', self._hoy_esperado, '#1e3a5f')
        metric(4, 'Saldo Real', self._hoy_real, '#7c3aed')
        metric(5, 'Diferencia', self._hoy_dif)

    def _refresh_hoy(self):
        today = date.today().strftime('%Y-%m-%d')
        cuadre = get_cuadre_caja_by_fecha(today)
        movs = calcular_movimientos_caja(today)

        if cuadre:
            self._hoy_inicial.set(fmt(cuadre['saldo_inicial']))
            self._hoy_ingresos.set(fmt(cuadre['ingresos_caja']))
            self._hoy_egresos.set(fmt(cuadre['egresos_caja']))
            self._hoy_esperado.set(fmt(cuadre['saldo_esperado']))
            self._hoy_real.set(fmt(cuadre['saldo_real']) if cuadre['saldo_real'] is not None else '—')
            dif = cuadre.get('diferencia')
            if dif is not None:
                color = '#16a34a' if dif >= 0 else '#dc2626'
                self._hoy_dif.set(fmt_dif(dif))
            else:
                self._hoy_dif.set('—')
        else:
            saldo_ini = get_saldo_inicial_sugerido(today)
            self._hoy_inicial.set(fmt(saldo_ini))
            self._hoy_ingresos.set(fmt(movs['ingresos_caja']))
            self._hoy_egresos.set(fmt(movs['egresos_caja']))
            esp = saldo_ini + movs['ingresos_caja'] - movs['egresos_caja']
            self._hoy_esperado.set(fmt(esp))
            self._hoy_real.set('Pendiente')
            self._hoy_dif.set('—')

    # ── History table ─────────────────────────────────────────────────────────

    def _build_table(self):
        frame = ctk.CTkFrame(self, fg_color='white', corner_radius=12)
        frame.grid(row=2, column=0, sticky='nsew')
        frame.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(frame, text='Historial de Cuadres',
                     font=ctk.CTkFont(size=13, weight='bold'),
                     text_color='#1e3a5f').grid(row=0, column=0, sticky='w', padx=16, pady=(12, 4))

        setup_treeview_style('Caja', heading_bg='#dbeafe', heading_fg='#1e3a5f', select_bg='#bfdbfe')

        self._tree = ttk.Treeview(frame, style='Caja.Treeview',
                                   columns=COLS, show='headings', selectmode='browse')
        for col, lbl, w in zip(COLS, COL_LABELS, COL_WIDTHS):
            self._tree.heading(col, text=lbl)
            self._tree.column(col, width=w, minwidth=60, anchor='center')

        vsb = ttk.Scrollbar(frame, orient='vertical', command=self._tree.yview)
        self._tree.configure(yscrollcommand=vsb.set)

        self._tree.grid(row=1, column=0, sticky='ew', padx=10, pady=(0, 10))
        vsb.grid(row=1, column=1, sticky='ns', pady=10)

        self._tree.bind('<Double-1>', lambda _: self._edit())

        self._status = ctk.CTkLabel(frame, text='', font=ctk.CTkFont(size=11),
                                     text_color='#666')
        self._status.grid(row=2, column=0, columnspan=2, sticky='w', padx=12, pady=(0, 6))

    # ── Data ─────────────────────────────────────────────────────────────────

    def _on_period(self, *_):
        self._mes = MONTH_NAMES.index(self._mes_cb.get()) + 1
        self._ano = int(self._ano_cb.get())
        self.refresh()

    def refresh(self):
        self._refresh_hoy()
        self._data = get_cuadres_caja(mes=self._mes, ano=self._ano)
        self._tree.delete(*self._tree.get_children())

        for i, c in enumerate(self._data):
            tag = 'even' if i % 2 == 0 else 'odd'
            dif = c.get('diferencia')
            if dif is not None:
                if dif > 0:
                    tag = 'sobrante'
                elif dif < 0:
                    tag = 'faltante'

            estado = 'Cerrado' if c.get('cerrado') else 'Pendiente'
            self._tree.insert('', 'end', iid=str(c['id']), tags=(tag,),
                              values=(
                                  c['fecha'],
                                  fmt(c['saldo_inicial']),
                                  fmt(c['ingresos_caja']),
                                  fmt(c['egresos_caja']),
                                  fmt(c['saldo_esperado']),
                                  fmt(c['saldo_real']) if c['saldo_real'] is not None else '—',
                                  fmt_dif(dif) if dif is not None else '—',
                                  estado,
                              ))

        fit_tree_rows(self._tree, len(self._data), max_rows=14)
        self._tree.tag_configure('even', background='white', foreground='#1f2937')
        self._tree.tag_configure('odd', background='#f8fafc', foreground='#1f2937')
        self._tree.tag_configure('sobrante', background='#f0fdf4', foreground='#15803d')
        self._tree.tag_configure('faltante', background='#fef2f2', foreground='#dc2626')
        self._status.configure(text=f'{len(self._data)} cuadres registrados')

    def _selected_id(self):
        sel = self._tree.selection()
        return int(sel[0]) if sel else None

    def _new(self):
        CajaForm(self, None, self.refresh)

    def _edit(self):
        cid = self._selected_id()
        if cid is None:
            messagebox.showinfo('Aviso', 'Selecciona un cuadre para editar.')
            return
        data = next((c for c in self._data if c['id'] == cid), None)
        if data:
            CajaForm(self, data, self.refresh)

    def _delete(self):
        cid = self._selected_id()
        if cid is None:
            messagebox.showinfo('Aviso', 'Selecciona un cuadre para eliminar.')
            return
        if messagebox.askyesno('Confirmar', '¿Eliminar este cuadre?'):
            try:
                delete_cuadre_caja(cid)
            except AppValidationError as exc:
                messagebox.showerror('Error', str(exc))
                return
            self.refresh()


# ── Form dialog ───────────────────────────────────────────────────────────────

class CajaForm(ctk.CTkToplevel):
    def __init__(self, parent, data, on_save):
        super().__init__(parent)
        self.on_save = on_save
        self.editing_id = data['id'] if data else None

        title = 'Editar Cuadre' if data else 'Cuadrar Caja'
        self.title(title)
        self.geometry('520x600')
        self.minsize(480, 520)
        self.resizable(True, True)
        self.transient(parent.winfo_toplevel())
        self.grab_set()

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
        main = ctk.CTkScrollableFrame(self, fg_color='white')
        main.pack(fill='both', expand=True)

        ctk.CTkLabel(main, text='Cuadre de Caja' if not self.editing_id else 'Editar Cuadre',
                     font=ctk.CTkFont(size=18, weight='bold'),
                     text_color='#1e3a5f').pack(anchor='w', padx=24, pady=(16, 4))

        fecha_hoy = date.today().strftime('%Y-%m-%d')
        fecha_ini = d.get('fecha', fecha_hoy)

        def lbl(text, hint=''):
            frame = ctk.CTkFrame(main, fg_color='transparent')
            frame.pack(anchor='w', padx=24, pady=(10, 0), fill='x')
            ctk.CTkLabel(frame, text=text, font=ctk.CTkFont(size=12),
                         text_color='#555').pack(side='left')
            if hint:
                ctk.CTkLabel(frame, text=hint, font=ctk.CTkFont(size=10),
                             text_color='#999').pack(side='left', padx=(6, 0))

        def entry(default='', **kwargs):
            e = ctk.CTkEntry(main, height=36, **kwargs)
            e.pack(fill='x', padx=24, pady=2)
            if default:
                e.insert(0, str(default))
            return e

        # Fecha
        lbl('Fecha (YYYY-MM-DD)')
        self._fecha = entry(fecha_ini)
        if not self.editing_id:
            self._fecha.configure(state='disabled')

        # Saldo inicial
        saldo_ini = d.get('saldo_inicial', '')
        if not saldo_ini and not self.editing_id:
            saldo_ini = get_saldo_inicial_sugerido(fecha_ini)
        lbl('Saldo inicial en caja', '(cuánto había al abrir)')
        self._saldo_ini = entry(saldo_ini if saldo_ini else '')

        # Info automática
        movs = calcular_movimientos_caja(fecha_ini)
        ing = d.get('ingresos_caja', movs['ingresos_caja'])
        egr = d.get('egresos_caja', movs['egresos_caja'])

        info = ctk.CTkFrame(main, fg_color='#f0f9ff', corner_radius=8)
        info.pack(fill='x', padx=24, pady=(12, 4))
        ctk.CTkLabel(info, text='Movimientos del día (calculados automáticamente)',
                     font=ctk.CTkFont(size=11, weight='bold'),
                     text_color='#1e3a5f').pack(anchor='w', padx=12, pady=(8, 4))

        def info_row(label, value, color='#1f2937'):
            row = ctk.CTkFrame(info, fg_color='transparent')
            row.pack(fill='x', padx=12, pady=2)
            ctk.CTkLabel(row, text=label, font=ctk.CTkFont(size=11),
                         text_color='#6b7280').pack(side='left')
            ctk.CTkLabel(row, text=f'  {value}', font=ctk.CTkFont(size=11, weight='bold'),
                         text_color=color).pack(side='left')

        info_row('Ingresos caja del día:', f'$ {ing:,.0f}'.replace(',', '.'), '#16a34a')
        info_row('Egresos caja del día:', f'$ {egr:,.0f}'.replace(',', '.'), '#dc2626')
        ctk.CTkLabel(info, text='(Los egresos en caja son los marcados como canal "Caja" en egresos)',
                     font=ctk.CTkFont(size=10), text_color='#9ca3af').pack(anchor='w', padx=12, pady=(2, 8))

        # Saldo real
        lbl('Saldo real en caja', '(lo que cuenta físicamente)')
        self._saldo_real = entry(d.get('saldo_real', '') if d.get('saldo_real') is not None else '')

        # Observaciones
        lbl('Observaciones')
        self._obs = entry(d.get('observaciones', '') or '')

        # Resultado en vivo
        self._result_frame = ctk.CTkFrame(main, fg_color='#f8fafc', corner_radius=8)
        self._result_frame.pack(fill='x', padx=24, pady=(12, 4))
        self._result_lbl = ctk.CTkLabel(self._result_frame, text='',
                                         font=ctk.CTkFont(size=13, weight='bold'),
                                         text_color='#1e3a5f')
        self._result_lbl.pack(padx=16, pady=12)

        self._ing_cache = ing
        self._egr_cache = egr
        self._saldo_ini.bind('<KeyRelease>', self._recalcular)
        self._saldo_real.bind('<KeyRelease>', self._recalcular)
        self._recalcular()

        # Buttons
        btn_frame = ctk.CTkFrame(main, fg_color='transparent')
        btn_frame.pack(fill='x', padx=24, pady=(12, 16))
        ctk.CTkButton(btn_frame, text='Cancelar', width=100, height=36,
                      fg_color='#ccc', text_color='#333', hover_color='#bbb',
                      command=self.destroy).pack(side='right', padx=(8, 0))
        ctk.CTkButton(btn_frame, text='Guardar Cuadre', width=140, height=36,
                      fg_color='#1e3a5f', hover_color='#2a5298',
                      command=self._save).pack(side='right')

    def _parse_val(self, widget):
        raw = widget.get().strip().replace('.', '').replace(',', '').replace('$', '').replace(' ', '')
        try:
            return float(raw)
        except ValueError:
            return None

    def _recalcular(self, *_):
        ini = self._parse_val(self._saldo_ini) or 0
        real = self._parse_val(self._saldo_real)
        esperado = ini + self._ing_cache - self._egr_cache

        if real is not None:
            dif = real - esperado
            if dif > 0:
                msg = f'SOBRANTE de $ {dif:,.0f}'.replace(',', '.')
                color = '#16a34a'
            elif dif < 0:
                msg = f'FALTANTE de $ {abs(dif):,.0f}'.replace(',', '.')
                color = '#dc2626'
            else:
                msg = 'CAJA CUADRADA exactamente'
                color = '#1e3a5f'
            self._result_lbl.configure(
                text=f'Esperado: $ {esperado:,.0f}   |   {msg}'.replace(',', '.'),
                text_color=color,
            )
        else:
            self._result_lbl.configure(
                text=f'Saldo esperado: $ {esperado:,.0f}'.replace(',', '.'),
                text_color='#1e3a5f',
            )

    def _save(self):
        fecha_raw = self._fecha.get().strip()
        if not fecha_raw:
            fecha_raw = date.today().strftime('%Y-%m-%d')

        ini_str = self._saldo_ini.get().strip().replace('.', '').replace(',', '').replace('$', '').replace(' ', '')
        real_str = self._saldo_real.get().strip().replace('.', '').replace(',', '').replace('$', '').replace(' ', '')

        if not ini_str:
            messagebox.showerror('Error', 'El saldo inicial es obligatorio.')
            return

        data = {
            'fecha': fecha_raw,
            'saldo_inicial': ini_str,
            'saldo_real': real_str if real_str else None,
            'observaciones': self._obs.get().strip(),
        }
        try:
            save_cuadre_caja(data, self.editing_id)
        except AppValidationError as exc:
            messagebox.showerror('Error', str(exc))
            return
        self.on_save()
        self.destroy()
