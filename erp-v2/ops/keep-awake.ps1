param(
    [string]$StateDirectory = ([System.IO.Path]::Combine($env:TEMP, 'overva-keep-awake')),
    [int]$HeartbeatSeconds = 30
)

$ErrorActionPreference = 'Stop'

if ($HeartbeatSeconds -lt 5) {
    throw 'HeartbeatSeconds must be at least 5.'
}

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class OvervaPowerRequest
{
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint executionState);
}
'@

$executionStateContinuous = [uint32]2147483648
$executionStateSystemRequired = [uint32]0x00000001
$executionStateAwayModeRequired = [uint32]0x00000040
$requestedState = $executionStateContinuous -bor $executionStateSystemRequired -bor $executionStateAwayModeRequired

New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
$pidPath = Join-Path $StateDirectory 'pid.txt'
$heartbeatPath = Join-Path $StateDirectory 'heartbeat.json'

Set-Content -LiteralPath $pidPath -Value $PID -Encoding ascii

try {
    while ($true) {
        $result = [OvervaPowerRequest]::SetThreadExecutionState($requestedState)
        if ($result -eq 0) {
            throw "SetThreadExecutionState failed with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())."
        }

        [ordered]@{
            pid = $PID
            updated_at = (Get-Date).ToString('o')
            mode = 'continuous-system-away'
        } | ConvertTo-Json | Set-Content -LiteralPath $heartbeatPath -Encoding utf8

        Start-Sleep -Seconds $HeartbeatSeconds
    }
}
finally {
    [void][OvervaPowerRequest]::SetThreadExecutionState($executionStateContinuous)
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}
