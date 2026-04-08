[Setup]
AppId={{B3DC1FCA-E7E6-4A6D-9A98-92F741A6E6DA}
AppName=Contabilidad Morsa
AppVerName=Contabilidad Morsa 1.0.0
AppVersion=1.0.0
AppPublisher=Contabilidad Morsa
AppPublisherURL=https://contabilidadmorsa.local
AppSupportURL=https://contabilidadmorsa.local
DefaultDirName={localappdata}\Programs\Contabilidad Morsa
DefaultGroupName=Contabilidad Morsa
OutputDir=..\dist_installer
OutputBaseFilename=ContabilidadMorsaSetup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupLogging=yes
UninstallDisplayIcon={app}\Contabilidad Morsa.exe
DisableProgramGroupPage=yes
CloseApplications=yes
RestartApplications=no
UsePreviousAppDir=yes
ChangesEnvironment=no
ChangesAssociations=no
WizardSizePercent=110

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
Source: "..\dist\Contabilidad Morsa\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Contabilidad Morsa"; Filename: "{app}\Contabilidad Morsa.exe"
Name: "{autodesktop}\Contabilidad Morsa"; Filename: "{app}\Contabilidad Morsa.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el escritorio"; GroupDescription: "Accesos directos:"

[Run]
Filename: "{app}\Contabilidad Morsa.exe"; Description: "Abrir Contabilidad Morsa"; Flags: nowait postinstall skipifsilent
