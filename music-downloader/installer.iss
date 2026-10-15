; Instalador de Windows (Inno Setup 6)
#define AppName "Deanp3"
#ifndef AppVersion
  #define AppVersion "1.2.0"
#endif

[Setup]
AppId={{6B7F2C1E-8E4A-4C1B-9B3E-6F2D8A1C5E77}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=claude-2
DefaultDirName={autopf}\Deanp3
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
UsePreviousAppDir=no
UsePreviousGroup=no
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=Output
OutputBaseFilename=Deanp3-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\Deanp3.exe
SetupIconFile=icon.ico

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; Limpia la versión anterior, que se llamaba "Descargador de Musica"
Type: filesandordirs; Name: "{autopf}\DescargadorMusica"
Type: files; Name: "{autodesktop}\Descargador de Musica.lnk"
Type: filesandordirs; Name: "{autoprograms}\Descargador de Musica"

[Files]
Source: "dist\Deanp3\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\Deanp3.exe"
Name: "{group}\Desinstalar {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\Deanp3.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Deanp3.exe"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
