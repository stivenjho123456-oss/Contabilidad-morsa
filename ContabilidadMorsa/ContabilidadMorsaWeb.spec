# -*- mode: python ; coding: utf-8 -*-

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, copy_metadata


project_dir = Path(SPECPATH)
root_dir = project_dir.parent

datas = [
    (str(root_dir / 'apps' / 'frontend' / 'dist'), 'apps/frontend/dist'),
    (str(root_dir / 'MARZO 2025.xlsx'), '.'),
    (str(root_dir / 'NOMINA DE  FEBRERO -2026.xlsx'), '.'),
]
datas += copy_metadata('fastapi')
datas += copy_metadata('starlette')
datas += copy_metadata('pydantic')
datas += copy_metadata('uvicorn')
datas += copy_metadata('openpyxl')
datas += copy_metadata('httpx')
datas += copy_metadata('python-multipart')

hiddenimports = [
    'openpyxl',
    'httpx',
    'database',
    'backup_manager',
    'migrate_excel',
    'migrate_nomina',
    'app_paths',
]
hiddenimports += collect_submodules('fastapi')
hiddenimports += collect_submodules('starlette')
hiddenimports += collect_submodules('pydantic')
hiddenimports += collect_submodules('uvicorn')
hiddenimports += collect_submodules('anyio')
hiddenimports += collect_submodules('openpyxl')
hiddenimports += collect_submodules('httpx')
hiddenimports += collect_submodules('multipart')


a = Analysis(
    [str(root_dir / 'apps' / 'backend' / 'launcher.py')],
    pathex=[str(root_dir), str(root_dir / 'apps' / 'backend'), str(project_dir)],
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
        bundle_identifier='com.contabilidadmorsa.web',
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
