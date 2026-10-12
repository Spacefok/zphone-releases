!include LogicLib.nsh

; Desktop creation is opt-in on the finish page. Keep the standard uninstall cleanup.
!ifndef BUILD_UNINSTALLER
  !define DO_NOT_CREATE_DESKTOP_SHORTCUT
!endif

LangString ZphoneDesktop 1033 "Add a shortcut to the desktop"
LangString ZphoneDesktop 1049 "Добавить ярлык на рабочий стол"
LangString ZphoneRun 1033 "Launch Zphone Preview"
LangString ZphoneRun 1049 "Запустить Zphone Preview"

!macro customFinishPage
  Function ZphoneRunAfterFinish
    ExecShell "open" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  FunctionEnd
  Function ZphoneDesktopAfterFinish
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
    WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
  FunctionEnd
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION ZphoneRunAfterFinish
  !define MUI_FINISHPAGE_RUN_TEXT "$(ZphoneRun)"
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION ZphoneDesktopAfterFinish
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "$(ZphoneDesktop)"
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !insertmacro MUI_PAGE_FINISH
!macroend

