import customtkinter as ctk
from database import get_dashboard_stats
from datetime import datetime
from ui_helpers import fix_scrollframe

MONTHS = {
    1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
    5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
    9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
}
MONTH_NAMES = [MONTHS[i] for i in range(1, 13)]

TIPO_COLORS = ['#e74c3c', '#e67e22', '#f39c12', '#2ecc71', '#3498db',
               '#9b59b6', '#1abc9c', '#e91e63', '#ff5722', '#607d8b']


def fmt(value):
    return f'$ {value:,.0f}'.replace(',', '.')


class DashboardView(ctk.CTkFrame):
    def __init__(self, parent, navigate=None):
        super().__init__(parent, fg_color='transparent')
        self._navigate = navigate
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(3, weight=1)

        now = datetime.now()
        self._mes = now.month
        self._ano = now.year

        self._build_header()
        self._build_quick_actions()
        self._build_cards()
        self._build_bottom()
        self.refresh()

    # ── UI construction ───────────────────────────────────────────────────────

    def _build_header(self):
        hdr = ctk.CTkFrame(self, fg_color='transparent')
        hdr.grid(row=0, column=0, sticky='ew', pady=(0, 18))
        hdr.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(hdr, text='Dashboard',
                     font=ctk.CTkFont(size=26, weight='bold'),
                     text_color='#1e3a5f').grid(row=0, column=0, sticky='w')

        period = ctk.CTkFrame(hdr, fg_color='white', corner_radius=10)
        period.grid(row=0, column=2, sticky='e')

        self._mes_combo = ctk.CTkComboBox(
            period, values=MONTH_NAMES, width=140, height=34,
            command=self._on_period)
        self._mes_combo.set(MONTHS[self._mes])
        self._mes_combo.grid(row=0, column=0, padx=(10, 4), pady=8)

        self._ano_combo = ctk.CTkComboBox(
            period, values=[str(y) for y in range(2023, 2030)], width=90, height=34,
            command=self._on_period)
        self._ano_combo.set(str(self._ano))
        self._ano_combo.grid(row=0, column=1, padx=(0, 10), pady=8)

    def _build_quick_actions(self):
        panel = ctk.CTkFrame(self, fg_color='#10253b', corner_radius=14)
        panel.grid(row=1, column=0, sticky='ew', pady=(0, 18))
        panel.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            panel,
            text='Accesos rapidos',
            font=ctk.CTkFont(size=14, weight='bold'),
            text_color='white',
        ).grid(row=0, column=0, sticky='w', padx=18, pady=(16, 2))
        ctk.CTkLabel(
            panel,
            text='Si quieres crear un proveedor nuevo, entra por "Proveedores y Base" o usa el botón directo de abajo.',
            font=ctk.CTkFont(size=12),
            text_color='#c7d2df',
            wraplength=760,
            justify='left',
        ).grid(row=1, column=0, sticky='w', padx=18, pady=(0, 12))

        actions = ctk.CTkFrame(panel, fg_color='transparent')
        actions.grid(row=2, column=0, sticky='w', padx=18, pady=(0, 16))

        self._quick_button(
            actions, 'Nuevo Proveedor', '#16a34a', '#15803d',
            lambda: self._go('proveedores'), 0
        )
        self._quick_button(
            actions, 'Registrar Egreso', '#1e3a5f', '#2a5298',
            lambda: self._go('egresos'), 1
        )
        self._quick_button(
            actions, 'Registrar Ingreso', '#2563eb', '#1d4ed8',
            lambda: self._go('ingresos'), 2
        )
        self._quick_button(
            actions, 'Ver Cierre Mensual', '#7c3aed', '#6d28d9',
            lambda: self._go('reportes'), 3
        )

    def _quick_button(self, parent, text, fg, hover, command, col):
        ctk.CTkButton(
            parent,
            text=text,
            width=160,
            height=36,
            fg_color=fg,
            hover_color=hover,
            command=command,
        ).grid(row=0, column=col, padx=(0 if col == 0 else 8, 0), pady=2)

    def _go(self, section):
        if self._navigate:
            self._navigate(section)

    def _build_cards(self):
        row = ctk.CTkFrame(self, fg_color='transparent')
        row.grid(row=2, column=0, sticky='ew', pady=(0, 18))
        row.grid_columnconfigure((0, 1, 2), weight=1)

        self._card_ing  = self._make_card(row, 'Total Ingresos', '#27ae60', '💰', 0)
        self._card_eg   = self._make_card(row, 'Total Egresos',  '#e74c3c', '💸', 1)
        self._card_util = self._make_card(row, 'Utilidad Bruta', '#2980b9', '📈', 2)

    def _make_card(self, parent, title, color, icon, col):
        f = ctk.CTkFrame(parent, fg_color='white', corner_radius=12)
        f.grid(row=0, column=col, sticky='ew',
               padx=(0 if col == 0 else 8, 8 if col < 2 else 0))

        ctk.CTkLabel(f, text=f'{icon}  {title}',
                     font=ctk.CTkFont(size=12), text_color='#666').pack(
            anchor='w', padx=18, pady=(16, 4))

        lbl = ctk.CTkLabel(f, text='$ 0', font=ctk.CTkFont(size=22, weight='bold'),
                           text_color=color)
        lbl.pack(anchor='w', padx=18, pady=(0, 16))
        return lbl

    def _build_bottom(self):
        bot = ctk.CTkFrame(self, fg_color='transparent')
        bot.grid(row=3, column=0, sticky='nsew')
        bot.grid_columnconfigure(0, weight=1)
        bot.grid_columnconfigure(1, weight=1)
        bot.grid_rowconfigure(0, weight=1)

        # Left: egresos por naturaleza
        left = ctk.CTkFrame(bot, fg_color='white', corner_radius=12)
        left.grid(row=0, column=0, sticky='nsew', padx=(0, 8))
        left.grid_rowconfigure(1, weight=1)

        ctk.CTkLabel(left, text='Egresos por Naturaleza',
                     font=ctk.CTkFont(size=15, weight='bold'),
                     text_color='#1e3a5f').grid(row=0, column=0, sticky='w', padx=18, pady=(14, 6))

        self._tipo_frame = ctk.CTkScrollableFrame(left, fg_color='white')
        self._tipo_frame.grid(row=1, column=0, sticky='nsew', padx=8, pady=(0, 8))
        fix_scrollframe(self._tipo_frame)
        left.grid_columnconfigure(0, weight=1)

        # Right: ultimos egresos
        right = ctk.CTkFrame(bot, fg_color='white', corner_radius=12)
        right.grid(row=0, column=1, sticky='nsew')
        right.grid_rowconfigure(1, weight=1)

        ctk.CTkLabel(right, text='Ultimos Egresos',
                     font=ctk.CTkFont(size=15, weight='bold'),
                     text_color='#1e3a5f').grid(row=0, column=0, sticky='w', padx=18, pady=(14, 6))

        self._recent_frame = ctk.CTkScrollableFrame(right, fg_color='white')
        fix_scrollframe(self._recent_frame)
        self._recent_frame.grid(row=1, column=0, sticky='nsew', padx=8, pady=(0, 8))
        right.grid_columnconfigure(0, weight=1)

    # ── Data ─────────────────────────────────────────────────────────────────

    def _on_period(self, *_):
        self._mes = MONTH_NAMES.index(self._mes_combo.get()) + 1
        self._ano = int(self._ano_combo.get())
        self.refresh()

    def refresh(self):
        stats = get_dashboard_stats(mes=self._mes, ano=self._ano)

        self._card_ing.configure(text=fmt(stats['total_ingresos']))
        self._card_eg.configure(text=fmt(stats['total_egresos']))

        util = stats['utilidad']
        self._card_util.configure(text=fmt(util),
                                   text_color='#27ae60' if util >= 0 else '#e74c3c')

        # Egresos by tipo
        for w in self._tipo_frame.winfo_children():
            w.destroy()

        total_eg = stats['total_egresos'] or 1
        for i, (tipo, total) in enumerate(stats['egresos_by_tipo']):
            color = TIPO_COLORS[i % len(TIPO_COLORS)]
            row = ctk.CTkFrame(self._tipo_frame, fg_color='transparent')
            row.pack(fill='x', pady=3)
            row.grid_columnconfigure(1, weight=1)

            ctk.CTkLabel(row, text='●', text_color=color,
                         font=ctk.CTkFont(size=18), width=22).grid(row=0, column=0, sticky='w')
            ctk.CTkLabel(row, text=tipo or '—',
                         font=ctk.CTkFont(size=12), text_color='#444',
                         anchor='w').grid(row=0, column=1, sticky='w', padx=6)
            pct = total / total_eg * 100
            ctk.CTkLabel(row, text=f'{fmt(total)}  ({pct:.1f}%)',
                         font=ctk.CTkFont(size=12, weight='bold'),
                         text_color='#333').grid(row=0, column=2, sticky='e')

        # Recent egresos
        for w in self._recent_frame.winfo_children():
            w.destroy()

        for eg in stats['recent_egresos']:
            row = ctk.CTkFrame(self._recent_frame, fg_color='#f5f7fa', corner_radius=8)
            row.pack(fill='x', pady=2)
            row.grid_columnconfigure(1, weight=1)

            ctk.CTkLabel(row, text=eg['fecha'], font=ctk.CTkFont(size=11),
                         text_color='#888', width=88).grid(row=0, column=0, padx=(10, 4), pady=8)
            ctk.CTkLabel(row, text=(eg['razon_social'] or '')[:28],
                         font=ctk.CTkFont(size=12), text_color='#333',
                         anchor='w').grid(row=0, column=1, sticky='ew', padx=4)
            ctk.CTkLabel(row, text=fmt(eg['valor']),
                         font=ctk.CTkFont(size=12, weight='bold'),
                         text_color='#e74c3c').grid(row=0, column=2, padx=10)
