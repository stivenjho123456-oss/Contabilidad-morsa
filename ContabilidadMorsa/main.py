import os
from pathlib import Path

import customtkinter as ctk
import tkinter.ttk as ttk
from tkinter import messagebox

from backup_manager import create_startup_backup_if_needed
from database import DB_PATH, get_connection, init_db, sync_nomina_to_egresos
from migrate_excel import EXCEL_PATH, migrate
from migrate_nomina import EXCEL_NOMINA_PATH, migrate_nomina
from views.backups import BackupsView
from views.caja import CajaView
from views.dashboard import DashboardView
from views.egresos import EgresosView
from views.ingresos import IngresosView
from views.nomina import NominaView
from views.proveedores import ProveedoresView
from views.reportes import ReportesView


APP_TITLE = "Contabilidad Morsa"
SIDEBAR_ITEMS = (
    ("dashboard", "Dashboard"),
    ("caja", "Cuadre de Caja"),
    ("egresos", "Egresos"),
    ("ingresos", "Ingresos"),
    ("nomina", "Nomina"),
    ("proveedores", "Proveedores y Base"),
    ("reportes", "Reportes"),
    ("backups", "Backups"),
)


def _db_has_data():
    if not Path(DB_PATH).exists():
        return False

    conn = get_connection()
    try:
        for table in ("proveedores", "egresos", "ingresos"):
            total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            if total:
                return True
    finally:
        conn.close()
    return False


def bootstrap_data():
    init_db()
    if not _db_has_data() and os.path.exists(EXCEL_PATH):
        try:
            migrate()
        except Exception as exc:
            messagebox.showerror(
                "Error de migracion",
                "No se pudo importar el Excel inicial.\n\n"
                f"Archivo: {EXCEL_PATH}\n"
                f"Detalle: {exc}",
            )

    if os.path.exists(EXCEL_NOMINA_PATH):
        conn = get_connection()
        try:
            total = conn.execute('SELECT COUNT(*) FROM nomina_resumen').fetchone()[0]
        finally:
            conn.close()
        if not total:
            try:
                migrate_nomina()
            except Exception as exc:
                messagebox.showerror(
                    "Error de migracion",
                    "No se pudo importar el archivo de nomina.\n\n"
                    f"Archivo: {EXCEL_NOMINA_PATH}\n"
                    f"Detalle: {exc}",
                )
        try:
            sync_nomina_to_egresos()
        except Exception as exc:
            messagebox.showerror(
                "Error de sincronizacion",
                "No se pudieron generar los egresos automaticos desde nomina.\n\n"
                f"Detalle: {exc}",
            )
    try:
        create_startup_backup_if_needed()
    except Exception as exc:
        messagebox.showerror(
            "Error de backup",
            "No se pudo crear el backup automatico de la base de datos.\n\n"
            f"Detalle: {exc}",
        )


class SidebarButton(ctk.CTkButton):
    def set_active(self, active):
        self.configure(
            fg_color="#16324f" if active else "transparent",
            hover_color="#234b75",
            text_color="white" if active else "#c7d2df",
        )


class ContabilidadApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title(APP_TITLE)
        self.geometry("1400x860")
        self.minsize(1180, 720)
        self.configure(fg_color="#edf2f7")
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self._buttons = {}
        self._views = {}
        self._current = None

        self._build_sidebar()
        self._build_content()
        self.show_view("dashboard")

    def _build_sidebar(self):
        sidebar = ctk.CTkFrame(self, fg_color="#10253b", corner_radius=0, width=250)
        sidebar.grid(row=0, column=0, sticky="nsew")
        sidebar.grid_propagate(False)
        sidebar.grid_rowconfigure(len(SIDEBAR_ITEMS) + 2, weight=1)

        ctk.CTkLabel(
            sidebar,
            text="Contabilidad\nMorsa",
            justify="left",
            font=ctk.CTkFont(size=28, weight="bold"),
            text_color="white",
        ).grid(row=0, column=0, sticky="w", padx=24, pady=(28, 8))

        ctk.CTkLabel(
            sidebar,
            text="Control mensual de ingresos, egresos y proveedores",
            justify="left",
            wraplength=180,
            font=ctk.CTkFont(size=12),
            text_color="#9eb0c1",
        ).grid(row=1, column=0, sticky="w", padx=24, pady=(0, 20))

        for row, (key, label) in enumerate(SIDEBAR_ITEMS, start=2):
            button = SidebarButton(
                sidebar,
                text=label,
                anchor="w",
                height=44,
                corner_radius=10,
                border_width=0,
                command=lambda name=key: self.show_view(name),
            )
            button.grid(row=row, column=0, sticky="ew", padx=18, pady=5)
            button.set_active(False)
            self._buttons[key] = button

        ctk.CTkLabel(
            sidebar,
            text="SQLite local\nMigracion automatica desde Excel",
            justify="left",
            font=ctk.CTkFont(size=11),
            text_color="#7f93a8",
        ).grid(row=len(SIDEBAR_ITEMS) + 3, column=0, sticky="sw", padx=24, pady=24)

    def _build_content(self):
        self._content = ctk.CTkFrame(self, fg_color="transparent")
        self._content.grid(row=0, column=1, sticky="nsew", padx=20, pady=20)
        self._content.grid_columnconfigure(0, weight=1)
        self._content.grid_rowconfigure(0, weight=1)

    def _create_view(self, name):
        view_map = {
            "dashboard": lambda parent: DashboardView(parent, navigate=self.show_view),
            "caja": CajaView,
            "egresos": EgresosView,
            "ingresos": IngresosView,
            "nomina": NominaView,
            "proveedores": ProveedoresView,
            "reportes": ReportesView,
            "backups": BackupsView,
        }
        view = view_map[name](self._content)
        view.grid(row=0, column=0, sticky="nsew")
        self._views[name] = view
        return view

    def show_view(self, name):
        if self._current == name:
            view = self._views.get(name)
            if view and hasattr(view, "refresh"):
                view.refresh()
            return

        if self._current and self._current in self._views:
            self._views[self._current].grid_remove()

        view = self._views.get(name) or self._create_view(name)
        if hasattr(view, "refresh"):
            view.refresh()
        view.grid()

        for key, button in self._buttons.items():
            button.set_active(key == name)

        self._current = name


def main():
    ctk.set_appearance_mode("light")
    ctk.set_default_color_theme("blue")
    # Use 'alt' so ttk Treeview keeps custom colors but preserves a light table body.
    ttk.Style().theme_use('alt')
    bootstrap_data()
    app = ContabilidadApp()
    app.mainloop()


if __name__ == "__main__":
    main()
