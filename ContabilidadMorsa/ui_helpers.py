from tkinter import ttk

"""
Utilidades de UI para garantizar colores correctos en Windows.
CTkScrollableFrame tiene un canvas interno que no siempre respeta fg_color='white',
lo que causa fondos negros en Windows. Este helper lo fuerza explicitamente.
"""

BG = 'white'
TEXT = '#1e293b'
TEXT_MUTED = '#475569'


def fix_scrollframe(sf):
    """Fuerza el fondo blanco del canvas interno de un CTkScrollableFrame."""
    try:
        sf._parent_canvas.configure(bg=BG)
    except Exception:
        pass
    try:
        sf.configure(fg_color=BG)
    except Exception:
        pass


def setup_toplevel(window):
    """Configura un CTkToplevel con fondo blanco garantizado en Windows."""
    try:
        window.configure(fg_color=BG)
    except Exception:
        pass


def fit_tree_rows(tree, row_count, min_rows=1, max_rows=14):
    """Evita que un Treeview con pocos registros deje un bloque oscuro gigante."""
    try:
        tree.configure(height=max(min_rows, min(max_rows, int(row_count))))
    except Exception:
        pass


def setup_treeview_style(name, heading_bg='#e2e8f0', heading_fg='#1e3a5f', select_bg='#dbeafe'):
    """Aplica un estilo limpio y claro para ttk.Treeview."""
    style = ttk.Style()
    style.theme_use('alt')
    style.layout(
        f'{name}.Treeview',
        [('Treeview.treearea', {'sticky': 'nswe'})],
    )
    style.configure(
        f'{name}.Treeview',
        background='white',
        fieldbackground='white',
        foreground='#1f2937',
        rowheight=28,
        borderwidth=0,
        relief='flat',
        font=('Segoe UI', 10),
    )
    style.configure(
        f'{name}.Treeview.Heading',
        background=heading_bg,
        foreground=heading_fg,
        borderwidth=0,
        relief='flat',
        padding=(8, 8),
        font=('Segoe UI', 10, 'bold'),
    )
    style.map(
        f'{name}.Treeview',
        background=[('selected', select_bg)],
        foreground=[('selected', '#1e3a5f')],
    )
    style.map(
        f'{name}.Treeview.Heading',
        background=[('active', heading_bg)],
        foreground=[('active', heading_fg)],
    )
    return style
