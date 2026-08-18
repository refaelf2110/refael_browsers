# escape=`
# Windows Server with Desktop Experience (LTSC 2022).
# NOTE: windows/servercore does NOT work — browsers crash with STATUS_ACCESS_VIOLATION
# because WinRT COM classes (IAppCapability etc.) are absent in the Server Core SKU.
# Requires Docker Desktop in Windows Containers mode.
FROM mcr.microsoft.com/windows/server:ltsc2022

SHELL ["powershell", "-Command", "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue';"]

# ── Install Node.js (LTS) ────────────────────────────────────────────────────
RUN $nodeVersion = 'v22.15.0'; `
    $url = 'https://nodejs.org/dist/' + $nodeVersion + '/node-' + $nodeVersion + '-x64.msi'; `
    Write-Host ('Downloading Node.js ' + $nodeVersion + '...'); `
    Invoke-WebRequest -Uri $url -OutFile C:\node.msi; `
    Start-Process msiexec.exe -Wait -ArgumentList '/I C:\node.msi /quiet /norestart'; `
    Remove-Item C:\node.msi

# Verify Node.js is on PATH
RUN node --version; npm --version

WORKDIR C:\app

# ── Install Playwright and Chromium ─────────────────────────────────────────
COPY package.json .
# Prevent framework-bundled browser downloads — we use existing binaries from the cache volume.
ENV TAIKO_SKIP_BROWSER_DOWNLOAD=1
RUN npm install

# Install Edge channels via Playwright — Edge binaries live in the system
# install path and are not sourced from the S3 browser cache.
# (Chrome and Firefox are pulled from S3 at container startup by sync_browsers_from_s3.js)
RUN npx playwright install msedge msedge-beta msedge-dev

# Install Visual C++ Redistributable — provides msvcp140_1.dll required by Firefox
RUN Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile C:\vcredist.exe; `
    Start-Process C:\vcredist.exe -Wait -ArgumentList '/quiet /norestart'; `
    Remove-Item C:\vcredist.exe

# ── Firefox extension: inject custom auth header into all requests ────────────
COPY header-injector/ C:\header-injector\
RUN Compress-Archive -Path C:\header-injector\* -DestinationPath C:\app\header-injector.zip; `
    Rename-Item C:\app\header-injector.zip C:\app\header-injector.xpi; `
    Remove-Item -Recurse -Force C:\header-injector

# ── Copy application scripts ─────────────────────────────────────────────────
COPY sync_browsers_from_s3.js .
COPY run_all.js .
COPY run_mini.js .
COPY run_extractor.js .
COPY window_elements_extractor.html .
COPY run_debug.js .
COPY generate_html.js .
COPY db.js .
COPY test_page.html .
COPY cypress.config.js .
COPY cypress-detection.cy.js .
COPY testcafe-detection.js .
COPY interceptions_runner.js .
COPY interceptor_page.html .
COPY entrypoint.ps1 .

# ── Default command ──────────────────────────────────────────────────────────
CMD ["powershell", "-File", "C:\\app\\entrypoint.ps1"]
