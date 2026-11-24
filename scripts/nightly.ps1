# Nightly U21 import, run by the Windows scheduled task "U21 Rankings Nightly" (wakes the PC).
#  1. starts the rankings server if it isn't running
#  2. starts the browser (Brave/Chrome, where the extension lives) if it isn't running
#  3. keeps the PC awake and asks the extension to run, then waits for the result
# Log: data\nightly-task.log
param([int]$WaitMinutes = 25, [switch]$ServerOnly)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'data\nightly-task.log'
$server = 'http://localhost:4700'
$hdr = @{ 'X-U21-Auto' = '1' }
function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Out-File -FilePath $log -Append -Encoding utf8 }

# Keep the system awake AND the screen on while this script runs (released when it exits).
# Screen on matters: in Modern Standby (screen off) Windows suspends the browser.
Add-Type -Namespace U21 -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
[void][U21.Power]::SetThreadExecutionState([uint32]'0x80000003') # ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED

function ServerUp { try { Invoke-RestMethod "$server/api/auto/last" -Headers $hdr -TimeoutSec 5 | Out-Null; $true } catch { $false } }

if (-not (ServerUp)) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
  Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Hidden
  for ($i = 0; $i -lt 30 -and -not (ServerUp); $i++) { Start-Sleep 2 }
  if (ServerUp) { Log 'Started the rankings server.' } else { Log 'ERROR: rankings server would not start.'; exit 1 }
}
if ($ServerOnly) { exit 0 }

Log 'Nightly run starting.'
$browsers = @(
  'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe',
  "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe",
  'C:\Program Files\Google\Chrome\Application\chrome.exe',
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
if (-not (Get-Process brave, chrome -ErrorAction SilentlyContinue)) {
  $exe = $browsers | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($exe) { Start-Process -FilePath $exe -ArgumentList '--no-startup-window'; Log "Started browser: $exe" }
  else { Log 'ERROR: no Brave/Chrome found.' }
}

$before = $null
try { $before = (Invoke-RestMethod "$server/api/auto/last" -Headers $hdr).last.at } catch {}
try { Invoke-RestMethod "$server/api/auto/request" -Method Post -Headers $hdr | Out-Null } catch { Log "ERROR: request failed: $_" }

$end = (Get-Date).AddMinutes($WaitMinutes)
while ((Get-Date) -lt $end) {
  Start-Sleep 20
  try {
    $last = (Invoke-RestMethod "$server/api/auto/last" -Headers $hdr).last
    if ($last -and $last.at -ne $before) { exit 0 } # the server logs the result
  } catch {}
}
Log "ERROR: the browser extension did not report back within $WaitMinutes minutes (is it loaded and enabled?)."
exit 2
