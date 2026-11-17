; Instalador do Gerador de Leads PRO (gerado por windows/build.sh).
; Instala só para o usuário atual — não pede senha de administrador.
Unicode true
!include "MUI2.nsh"

!define NOME "Gerador de Leads PRO"
!define PASTA "GeradorDeLeadsPRO"
!ifndef VERSAO
  !define VERSAO "0.1.0"
!endif

Name "${NOME}"
OutFile "${SAIDA}"
InstallDir "$LOCALAPPDATA\Programs\${PASTA}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "${STAGE}/icone.ico"
UninstallIcon "${STAGE}/icone.ico"
VIProductVersion "${VERSAO}.0"
VIAddVersionKey "ProductName" "${NOME}"
VIAddVersionKey "FileVersion" "${VERSAO}"
VIAddVersionKey "FileDescription" "Instalador do ${NOME}"
VIAddVersionKey "LegalCopyright" ""

!define MUI_ICON "${STAGE}/icone.ico"
!define MUI_UNICON "${STAGE}/icone.ico"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o ${NOME} agora"
!define MUI_FINISHPAGE_RUN_FUNCTION Abrir

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Function Abrir
  ExecShell "open" "$DESKTOP\${NOME}.lnk"
FunctionEnd

Section "Instalar"
  ; Fecha uma cópia aberta antes de sobrescrever os arquivos.
  nsExec::Exec 'taskkill /F /IM "gerador-leads-node.exe"'
  RMDir /r "$INSTDIR\app"
  SetOutPath "$INSTDIR"
  File /r "${STAGE}/*.*"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"

  SetOutPath "$INSTDIR\app"
  CreateShortCut "$DESKTOP\${NOME}.lnk" "$INSTDIR\gerador-leads-node.exe" '"$INSTDIR\app\windows\iniciar.mjs"' "$INSTDIR\icone.ico" 0 SW_SHOWMINIMIZED
  CreateDirectory "$SMPROGRAMS\${NOME}"
  CreateShortCut "$SMPROGRAMS\${NOME}\${NOME}.lnk" "$INSTDIR\gerador-leads-node.exe" '"$INSTDIR\app\windows\iniciar.mjs"' "$INSTDIR\icone.ico" 0 SW_SHOWMINIMIZED
  CreateShortCut "$SMPROGRAMS\${NOME}\Desinstalar.lnk" "$INSTDIR\Desinstalar.exe"

  !define CHAVE "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PASTA}"
  WriteRegStr HKCU "${CHAVE}" "DisplayName" "${NOME}"
  WriteRegStr HKCU "${CHAVE}" "DisplayVersion" "${VERSAO}"
  WriteRegStr HKCU "${CHAVE}" "DisplayIcon" "$INSTDIR\icone.ico"
  WriteRegStr HKCU "${CHAVE}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegDWORD HKCU "${CHAVE}" "NoModify" 1
  WriteRegDWORD HKCU "${CHAVE}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "gerador-leads-node.exe"'
  Delete "$DESKTOP\${NOME}.lnk"
  RMDir /r "$SMPROGRAMS\${NOME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PASTA}"
  ; As listas salvas ficam em %APPDATA%\Gerador de Leads PRO (não são apagadas).
SectionEnd
