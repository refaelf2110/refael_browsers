# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A Windows-container-based Playwright example that launches Chromium inside a Docker container and fetches a page title. Requires **Docker Desktop in Windows Containers mode** (not Linux containers).

The base image is `mcr.microsoft.com/windows/server:ltsc2022` (Windows Server with Desktop Experience), not `windows/servercore`. The Desktop Experience SKU is required because modern browsers depend on WinRT COM classes (`IAppCapability` etc.) that are absent in Server Core.

## Build and Run

```bat
build_and_run.bat
```

This builds the Docker image (`playwright-windows-example`) and runs it. Alternatively, run steps manually:

```bat
docker build -t playwright-windows-example .
docker run --rm playwright-windows-example
```

## Architecture

- **Dockerfile** — Uses `mcr.microsoft.com/windows/server:ltsc2022` (Desktop Experience) as the base. Installs Node.js v22.15.0 LTS via MSI at build time, then installs Playwright and downloads only the Chromium browser binary (`npx playwright install chromium`).
- **entrypoint.ps1** — Runs at container startup. Resolves hostnames via TCP DNS (using `Resolve-DnsName -TcpOnly`) and writes them to the hosts file, then launches `node get_title.js`. Required because WinNAT drops outbound UDP traffic from Windows containers, making standard UDP DNS unreliable. Add any new hostnames the script needs to the `$Hostnames` list here.
- **get_title.js** — Launches Chromium (headless, `--no-sandbox --disable-gpu`), navigates to `https://example.com`, prints the page title, then exits.
- **package.json** — Single dependency: `playwright` at latest.

## Key Constraints

- **Windows Containers mode is required.** The base image is Windows Server Core; switching Docker Desktop to Linux containers mode will cause the build to fail.
- Browser downloads happen inside the container image at build time, so no network access is needed at runtime.

## Why TCP DNS via entrypoint.ps1

WinNAT (Docker's NAT layer for Windows containers) silently drops outbound UDP packets to external hosts on this machine. Standard DNS uses UDP port 53, so container DNS resolution fails. The entrypoint resolves required hostnames via TCP DNS at startup and writes them to `C:\Windows\System32\drivers\etc\hosts`. TCP traffic is unaffected by this WinNAT issue.

## Why `windows/server` and not `windows/servercore`

`windows/servercore` lacks WinRT COM classes (`IAppCapability` etc.) that Chrome/Edge/Firefox renderer subprocesses require. All browsers crash immediately with `STATUS_ACCESS_VIOLATION` (0xC0000005) on Server Core regardless of launch flags. `windows/server` (Desktop Experience) includes these classes and browsers work correctly.
