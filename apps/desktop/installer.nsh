# electron-builder preserves missing shortcuts on reinstall/upgrade. Keep the
# Start menu launch entry discoverable without resetting desktop preferences.
!macro customInstall
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${ifNot} ${FileExists} "$newStartMenuLink"
      Push $keepShortcuts
      StrCpy $keepShortcuts "false"
      !insertmacro addStartMenuLink $keepShortcuts
      Pop $keepShortcuts
      ${ifNot} ${FileExists} "$newStartMenuLink"
        Abort "Unable to create the PRMonitor Start menu shortcut."
      ${endIf}
    ${endIf}
  !endif
!macroend
