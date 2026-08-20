Start-Process powershell.exe -WorkingDirectory (Split-Path -Parent $PSScriptRoot) -ArgumentList "-NoExit", "-Command", "bun run dev"
