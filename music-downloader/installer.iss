; Instalador de Windows (Inno Setup 6)
#define AppName "Descargador de Musica"
#ifndef AppVersion
  #define AppVersion "1.1.0"
#endif

[Setup]
AppId={{6B7F2C1E-8E4A-4C1B-9B3E-6F2D8A1C5E77}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=claude-2
DefaultDirName={autopf}\DescargadorMusica
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=Output
OutputBaseFilename=DescargadorMusica-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\DescargadorMusica.exe
SetupIconFile=icon.ico

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "dist\DescargadorMusica\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\DescargadorMusica.exe"
Name: "{group}\Desinstalar {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\DescargadorMusica.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\DescargadorMusica.exe"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
