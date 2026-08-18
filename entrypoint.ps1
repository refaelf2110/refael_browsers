# WinNAT drops outbound UDP, so standard DNS fails at runtime.
# Resolve all needed hostnames via TCP DNS before starting.
$hostnames = @(
    "example.com",
    "refael-browsers-cache.s3.us-east-1.amazonaws.com",
    "s3.us-east-1.amazonaws.com",
    "msedgewebdriverstorage.blob.core.windows.net",
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

# Sync browser binaries from S3 into C:\browsers (skips already-cached files).
# Set SKIP_DOWNLOAD=1 to bypass (use only what is already on disk — useful for local testing).
# Set BROWSER_FILTER=chrome,firefox (etc.) to sync only specific browser kinds.
if ($env:SKIP_DOWNLOAD -ne '1') {
    node sync_browsers_from_s3.js
} else {
    Write-Host "--- Skipping S3 browser sync (SKIP_DOWNLOAD=1) ---"
}

# Run browser x headless combinations and print results.
# Set RUN_MODE=mini (e.g. docker run -e RUN_MODE=mini ...) for a quick 3-version sample.
if ($env:RUN_MODE -eq 'download') {
    Write-Host "--- Download only (no tests) ---"
} elseif ($env:RUN_MODE -eq 'extractor-mini') {
    Write-Host "--- Extractor mini run (2 versions per browser kind) ---"
    $env:EXTRACTOR_ONLY = '1'
    node run_mini.js
} elseif ($env:RUN_MODE -eq 'mini') {
    Write-Host "--- Mini run (3 versions per category) ---"
    node run_mini.js
} elseif ($env:RUN_MODE -eq 'extractor') {
    Write-Host "--- Extractor run (window elements collection) ---"
    node run_extractor.js
} elseif ($env:RUN_MODE -eq 'interceptions') {
    Write-Host "--- Interceptions run (all frameworks, function-call capture) ---"
    node interceptions_runner.js
} elseif ($env:RUN_MODE -eq 'debug') {
    Write-Host "--- Debug run (selenium-chrome-131-headfull only) ---"
    node run_debug.js
} else {
    Write-Host "--- Full run (all versions) ---"
    node run_all.js
}
