# -*- mode: python ; coding: utf-8 -*-

import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files


project_dir = Path(SPECPATH)
datas = [
    (str(project_dir.parent / 'MARZO 2025.xlsx'), '.'),
    (str(project_dir.parent / 'NOMINA DE  FEBRERO -2026.xlsx'), '.'),
]
datas += collect_data_files('customtkinter')

hiddenimports = [
    'customtkinter',
    'tkcalendar',
    'openpyxl',
    'babel',
    'babel.numbers',
    'babel.dates',
]


a = Analysis(
    ['main.py'],
    pathex=[str(project_dir)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    [],
    name='Contabilidad Morsa',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    exclude_binaries=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    version=str(project_dir / 'version_info.txt') if sys.platform == 'win32' else None,
    codesign_identity=None,
    entitlements_file=None,
)

if sys.platform == 'darwin':
    coll = COLLECT(
        exe,
        a.binaries,
        a.datas,
        strip=False,
        upx=True,
        upx_exclude=[],
        name='Contabilidad Morsa',
    )
    app = BUNDLE(
        coll,
        name='Contabilidad Morsa.app',
        icon=None,
        bundle_identifier='com.contabilidadmorsa.desktop',
    )
else:
    coll = COLLECT(
        exe,
        a.binaries,
        a.datas,
        strip=False,
        upx=True,
        upx_exclude=[],
        name='Contabilidad Morsa',
    )
