@echo off
rem Studiolo setup: adds Studiolo with its icon to your Desktop and Start menu,
rem and gives the Studiolo folder the Studiolo icon. Nothing is installed or downloaded.
rem You can run this again any time (for example after moving the folder).
setlocal
set "STUDIOLO_DIR=%~dp0"
set "STUDIOLO_HTML=%~dp0Studiolo.html"
set "STUDIOLO_ICON=%~dp0resources\icons\studiolo.ico"

if not exist "%STUDIOLO_HTML%" (
  echo Studiolo.html was not found next to this file.
  echo Keep this file in the Studiolo folder and try again.
  pause
  exit /b 1
)

echo Adding Studiolo to your Desktop and Start menu...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$shell = New-Object -ComObject WScript.Shell;" ^
  "$places = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'));" ^
  "foreach ($place in $places) {" ^
  "  $link = $shell.CreateShortcut((Join-Path $place 'Studiolo.lnk'));" ^
  "  $link.TargetPath = $env:STUDIOLO_HTML;" ^
  "  $link.WorkingDirectory = $env:STUDIOLO_DIR;" ^
  "  $link.IconLocation = $env:STUDIOLO_ICON + ',0';" ^
  "  $link.Description = 'Studiolo - private file tools that run in your browser';" ^
  "  $link.Save()" ^
  "}"

rem Folder icon: Windows reads it from a hidden desktop.ini inside the folder.
if exist "%STUDIOLO_DIR%desktop.ini" attrib -h -s -r "%STUDIOLO_DIR%desktop.ini"
(
  echo [.ShellClassInfo]
  echo IconResource=resources\icons\studiolo.ico,0
  echo InfoTip=Studiolo - private file tools that run in your browser
) > "%STUDIOLO_DIR%desktop.ini"
attrib +h +s "%STUDIOLO_DIR%desktop.ini"
attrib +r "%STUDIOLO_DIR%."

echo.
echo Done. Open Studiolo from the icon on your Desktop or from the Start menu.
echo (The folder icon can take a moment to appear; press F5 in File Explorer to refresh.)
echo.
pause
