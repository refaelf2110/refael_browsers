# Resolve hostnames via TCP DNS (WinNAT drops UDP).
$hostnames = @(
    "obs.4.dev.cheqzone.com",
    "cheqzone.b-cdn.net"
)

foreach ($name in $hostnames) {
    try {
        $records = Resolve-DnsName -Name $name -Type A -Server 8.8.8.8 -TcpOnly -ErrorAction Stop
        $ip = ($records | Where-Object { $_.Type -eq 'A' } | Select-Object -First 1).IPAddress
        Add-Content -Path "C:\Windows\System32\drivers\etc\hosts" -Value "$ip $name"
        Write-Host "Resolved $name -> $ip"
    } catch {
        Write-Warning "Could not resolve ${name}: $_"
    }
}

node C:\app\run_mini.js
