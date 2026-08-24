# AlpacApps Infra — Prerequisite Installer (Windows)
#
# Windows counterpart of scripts/install-prereqs.sh. Installs and updates
# everything the setup needs, using winget.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-prereqs.ps1
#
# Installs: git, gh (GitHub CLI), node (+ npm/npx), Supabase CLI, wrangler,
#           PostgreSQL client (psql), Bitwarden CLI, typescript,
#           typescript-language-server
#
# Does NOT install: Claude Desktop / ChatGPT Desktop (download those yourself).
#
# STATUS: parse-checked under pwsh 7.6, but not yet run on real Windows.
# If a package id has changed, `winget search <name>` will find the current one.

$ErrorActionPreference = 'Stop'

function Info($m) { Write-Host "[info]  $m" -ForegroundColor Blue }
function Ok($m)   { Write-Host "[ok]    $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[warn]  $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[fail]  $m" -ForegroundColor Red }

Write-Host ""
Write-Host "======================================"
Write-Host "  AlpacApps Infra - Prerequisite Setup"
Write-Host "======================================"
Write-Host ""

# --- winget is the whole strategy; without it we cannot continue ---
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Fail "winget not found."
    Write-Host "  winget ships with Windows 11 and recent Windows 10 (App Installer)."
    Write-Host "  Install 'App Installer' from the Microsoft Store, then re-run this script."
    exit 1
}
Ok "winget available"

function Ensure-Package {
    param([string]$Id, [string]$Display = $Id, [string]$Cmd)

    if ($Cmd -and (Get-Command $Cmd -ErrorAction SilentlyContinue)) {
        Info "Upgrading $Display (if a newer version exists)..."
        winget upgrade --id $Id --silent --accept-package-agreements --accept-source-agreements 2>$null | Out-Null
        Ok "$Display"
        return
    }
    Info "Installing $Display..."
    winget install --id $Id --silent --accept-package-agreements --accept-source-agreements 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Warn "winget could not install $Display (id: $Id) - install it manually" }
    else { Ok "$Display installed" }
}

Write-Host ""
Info "=== winget packages ==="
Ensure-Package -Id 'Git.Git'                 -Display 'git'          -Cmd 'git'
Ensure-Package -Id 'GitHub.cli'              -Display 'gh'           -Cmd 'gh'
Ensure-Package -Id 'OpenJS.NodeJS.LTS'       -Display 'node + npm'   -Cmd 'node'
Ensure-Package -Id 'Supabase.CLI'            -Display 'supabase'     -Cmd 'supabase'
Ensure-Package -Id 'PostgreSQL.psqlODBC'     -Display 'psql client'  -Cmd 'psql'
Ensure-Package -Id 'Bitwarden.CLI'           -Display 'bw'           -Cmd 'bw'

# PATH may not reflect brand-new installs in this session
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path","User")

Write-Host ""
Info "=== npm global packages ==="
if (Get-Command npm -ErrorAction SilentlyContinue) {
    foreach ($pkg in @('wrangler','typescript','typescript-language-server')) {
        Info "Installing/updating $pkg..."
        npm install -g $pkg 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { Ok $pkg } else { Warn "npm could not install $pkg" }
    }
} else {
    Warn "npm not on PATH yet. Close this window, open a new PowerShell, and re-run to finish the npm packages."
}

# --- Summary ---
function Ver($cmd, $args) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) {
        try { (& $cmd $args 2>$null | Select-Object -First 1) } catch { "?" }
    } else { "not installed" }
}

Write-Host ""
Write-Host "======================================"
Write-Host "  Prerequisite setup complete"
Write-Host "======================================"
Write-Host ""
Write-Host "  git       $(Ver git --version)"
Write-Host "  gh        $(Ver gh --version)"
Write-Host "  node      $(Ver node --version)"
Write-Host "  npm       $(Ver npm --version)"
Write-Host "  supabase  $(Ver supabase --version)"
Write-Host "  wrangler  $(Ver wrangler --version)"
Write-Host "  bw        $(Ver bw --version)"
Write-Host ""
Write-Host "  Bitwarden (secrets vault):"
Write-Host "    bw login"
Write-Host "    `$env:BW_SESSION = & .\scripts\bw-unlock.ps1"
Write-Host ""
Write-Host "  If anything says 'not installed', open a NEW PowerShell window first -"
Write-Host "  PATH changes from winget do not reach the session that made them."
Write-Host ""
