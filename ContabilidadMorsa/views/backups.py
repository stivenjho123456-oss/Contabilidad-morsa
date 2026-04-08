from tkinter import messagebox, ttk

import customtkinter as ctk

from backup_manager import BACKUP_DIR, create_backup, list_backups
from database import AppValidationError
from ui_helpers import fit_tree_rows, setup_treeview_style


def fmt_size(num_bytes):
    value = float(num_bytes or 0)
    for unit in ('B', 'KB', 'MB', 'GB'):
        if value < 1024 or unit == 'GB':
            return f'{value:.1f} {unit}'
        value /= 1024
    return f'{value:.1f} GB'


class BackupsView(ctk.CTkFrame):
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
        ctk.CTkLabel(
            title,
            text='Backups',
            font=ctk.CTkFont(size=22, weight='bold'),
            text_color='#1e3a5f',
        ).pack(anchor='w')
        ctk.CTkLabel(
            title,
            text=f'Respaldos locales de la base SQLite en: {BACKUP_DIR}',
            font=ctk.CTkFont(size=12),
            text_color='#64748b',
            wraplength=820,
            justify='left',
        ).pack(anchor='w', pady=(2, 0))

        ctrl = ctk.CTkFrame(bar, fg_color='transparent')
        ctrl.pack(side='right', padx=12)
        ctk.CTkButton(
            ctrl, text='Crear Backup Ahora', width=150, height=32,
            fg_color='#1e3a5f', hover_color='#2a5298', command=self._create_backup
        ).pack(side='left', padx=(0, 6))
        ctk.CTkButton(
            ctrl, text='Refrescar', width=90, height=32,
            fg_color='#64748b', hover_color='#475569', command=self.refresh
        ).pack(side='left')

    def _build_table(self):
        frame = ctk.CTkFrame(self, fg_color='white', corner_radius=12)
        frame.grid(row=1, column=0, sticky='nsew')
        frame.grid_columnconfigure(0, weight=1)

        setup_treeview_style('Backup', heading_bg='#e2e8f0', heading_fg='#334155', select_bg='#dbeafe')

        cols = ('name', 'created', 'size', 'reason', 'path')
        self._tree = ttk.Treeview(frame, style='Backup.Treeview', columns=cols, show='headings')
        config = (
            ('name', 'Archivo', 280, 'w'),
            ('created', 'Creado', 140, 'center'),
            ('size', 'Tamaño', 110, 'e'),
            ('reason', 'Origen', 100, 'center'),
            ('path', 'Ruta', 520, 'w'),
        )
        for col, label, width, anchor in config:
            self._tree.heading(col, text=label)
            self._tree.column(col, width=width, anchor=anchor)

        scroll = ttk.Scrollbar(frame, orient='vertical', command=self._tree.yview)
        self._tree.configure(yscrollcommand=scroll.set)
        self._tree.grid(row=0, column=0, sticky='ew', padx=10, pady=10)
        scroll.grid(row=0, column=1, sticky='ns', pady=10)

        self._status = ctk.CTkLabel(frame, text='', font=ctk.CTkFont(size=11), text_color='#666')
        self._status.grid(row=1, column=0, columnspan=2, sticky='w', padx=12, pady=(0, 6))

    def refresh(self):
        self._rows = list_backups()
        self._tree.delete(*self._tree.get_children())
        total_bytes = 0
        for idx, row in enumerate(self._rows):
            tag = 'even' if idx % 2 == 0 else 'odd'
            self._tree.insert(
                '',
                'end',
                iid=row['name'],
                tags=(tag,),
                values=(
                    row['name'],
                    row['created_label'],
                    fmt_size(row['size_bytes']),
                    row['reason'],
                    row['path'],
                ),
            )
            total_bytes += row['size_bytes']
        fit_tree_rows(self._tree, len(self._rows), max_rows=12)
        self._tree.tag_configure('even', background='white', foreground='#1f2937')
        self._tree.tag_configure('odd', background='#f8fafc', foreground='#1f2937')
        latest = self._rows[0]['created_label'] if self._rows else 'Sin backups'
        self._status.configure(
            text=f'{len(self._rows)} backups  |  Espacio total: {fmt_size(total_bytes)}  |  Último: {latest}'
        )

    def _create_backup(self):
        try:
            info = create_backup('manual')
        except AppValidationError as exc:
            messagebox.showerror('Error', str(exc))
            return
        except OSError as exc:
            messagebox.showerror('Error', f'No se pudo crear el backup.\n\n{exc}')
            return
        self.refresh()
        messagebox.showinfo('Exito', f'Backup creado correctamente:\n{info["path"]}')
