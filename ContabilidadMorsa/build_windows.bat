@echo off
setlocal

set ROOT_DIR=%~dp0..
set APP_DIR=%ROOT_DIR%\ContabilidadMorsa
set DIST_DIR=%ROOT_DIR%\dist
set INSTALLER_DIR=%ROOT_DIR%\dist_installer
set FRONTEND_DIR=%ROOT_DIR%\apps\frontend

cd /d "%ROOT_DIR%"

where py >nul 2>nul || (
  echo ERROR: No se encontro el launcher "py" de Python.
  exit /b 1
)

where npm >nul 2>nul || (
  echo ERROR: No se encontro npm. Instala Node.js para compilar el frontend.
  exit /b 1
)

cd /d "%FRONTEND_DIR%"
npm install || exit /b 1
npm run build || exit /b 1
if not exist "%FRONTEND_DIR%\dist\index.html" (
  echo ERROR: El frontend no genero dist\index.html.
  exit /b 1
)

cd /d "%ROOT_DIR%"
py -m pip install -r "%ROOT_DIR%\apps\backend\requirements.txt" || exit /b 1
py -m pip install -r "%APP_DIR%\requirements-build.txt" || exit /b 1
py "%ROOT_DIR%\apps\backend\smoke_test.py" || exit /b 1

if exist "%ROOT_DIR%\build" rmdir /s /q "%ROOT_DIR%\build"
if exist "%DIST_DIR%" rmdir /s /q "%DIST_DIR%"
if exist "%INSTALLER_DIR%" rmdir /s /q "%INSTALLER_DIR%"

py -m PyInstaller "%APP_DIR%\ContabilidadMorsaWeb.spec" --clean --noconfirm || exit /b 1

if not exist "%DIST_DIR%\Contabilidad Morsa\Contabilidad Morsa.exe" (
  echo ERROR: El ejecutable no fue generado.
  exit /b 1
)
if not exist "%DIST_DIR%\Contabilidad Morsa\apps\frontend\dist\index.html" (
  echo ERROR: El frontend compilado no fue empaquetado dentro del build.
  exit /b 1
)
if not exist "%DIST_DIR%\Contabilidad Morsa\_internal" (
  echo ERROR: El directorio _internal no fue generado correctamente.
  exit /b 1
)

where iscc >nul 2>nul
if %errorlevel%==0 (
  iscc "%APP_DIR%\installer_windows.iss" || exit /b 1
) else (
  echo AVISO: Inno Setup no esta instalado o "iscc" no esta en PATH.
  echo        El build de la app ya quedo listo, pero no se genero el instalador.
)

echo.
echo Build Windows listo:
echo   %DIST_DIR%\Contabilidad Morsa
if exist "%INSTALLER_DIR%\ContabilidadMorsaSetup.exe" (
  echo Instalador listo:
  echo   %INSTALLER_DIR%\ContabilidadMorsaSetup.exe
)
