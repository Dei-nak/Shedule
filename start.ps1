param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
try {
    $node = Get-Command node -ErrorAction Stop
    $address = $null
    foreach ($schedulePort in 3000..3010) {
        $candidate = "http://127.0.0.1:$schedulePort"
        try {
            $health = Invoke-RestMethod "$candidate/api/health" -TimeoutSec 1
            if ($health.service -eq 'ir31-schedule' -and $health.version -eq 2) {
                $address = $candidate
                break
            }
        } catch { }
        $probe = [System.Net.Sockets.TcpClient]::new()
        try { $probe.Connect('127.0.0.1', $schedulePort); $busy = $true }
        catch { $busy = $false }
        finally { $probe.Dispose() }
        if ($busy) { continue }
        $env:PORT = [string]$schedulePort
        $process = Start-Process -FilePath $node.Source -ArgumentList 'server.cjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
        foreach ($attempt in 1..40) {
            Start-Sleep -Milliseconds 250
            try {
                $health = Invoke-RestMethod "$candidate/api/health" -TimeoutSec 1
                if ($health.service -eq 'ir31-schedule' -and $health.version -eq 2) { $address = $candidate; break }
            } catch { }
            if ($process.HasExited) { break }
        }
        if ($address) { break }
    }
    if (-not $address) { throw 'Could not start the schedule server.' }
    if ($NoBrowser) { Write-Output $address }
    else { Start-Process $address }
} catch {
    Write-Host 'Unable to open schedule. Node.js 20+ must be installed.'
    Write-Host $_.Exception.Message
    Read-Host 'Press Enter to close'
    exit 1
}
