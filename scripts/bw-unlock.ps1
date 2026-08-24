# bw-unlock.ps1 — print a Bitwarden session key, unlocking non-interactively.
#
# Windows counterpart of scripts/bw-unlock. Coding agents (Claude Code, Codex)
# need to read secrets from the vault without a human typing the master password
# every time. This stores the password once, DPAPI-encrypted, then unlocks from it.
#
# Usage:
#   $env:BW_SESSION = & .\scripts\bw-unlock.ps1
#   bw list items --session $env:BW_SESSION
#
# First run walks you through storing the password. After that it is silent.
#
# Storage: ConvertFrom-SecureString uses DPAPI, so the blob at
# %USERPROFILE%\.bw-master can only be decrypted by THIS Windows user on THIS
# machine. Copying the file elsewhere gets an attacker nothing.
#
# SECURITY: anything running as your user on this machine can still decrypt it.
# That is the trade for unattended agent access. Do not do this on a shared box.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$StoreFile = Join-Path $env:USERPROFILE '.bw-master'

function Fail($msg) { Write-Error "bw-unlock: $msg"; exit 1 }

if (-not (Get-Command bw -ErrorAction SilentlyContinue)) {
    Fail "Bitwarden CLI not found. Install it: winget install Bitwarden.CLI (or npm i -g @bitwarden/cli)"
}

# --- already unlocked? reuse it ---
if ($env:BW_SESSION) {
    $st = (bw status --session $env:BW_SESSION 2>$null) | Out-String
    if ($st -match '"status":"unlocked"') { Write-Output $env:BW_SESSION; exit 0 }
}

# --- must be logged in before we can unlock ---
$status = (bw status 2>$null) | Out-String
if ($status -match '"status":"unauthenticated"') { Fail "Not logged in. Run: bw login" }

function Read-StoredPassword {
    if (-not (Test-Path $StoreFile)) { return $null }
    try {
        $secure = Get-Content $StoreFile | ConvertTo-SecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try   { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    } catch { return $null }
}

function Store-Password {
    Write-Host ""
    Write-Host "No stored master password found - storing one now (this is a one-time step)." -ForegroundColor Yellow
    $s1 = Read-Host -AsSecureString "Bitwarden master password"
    $s2 = Read-Host -AsSecureString "Confirm"

    $b1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1)
    $b2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2)
    try {
        $p1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto($b1)
        $p2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto($b2)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b1)
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b2)
    }

    if ($p1 -ne $p2) { Fail "Passwords did not match." }
    if ([string]::IsNullOrEmpty($p1)) { Fail "Empty password." }

    # verify before storing, so we never persist a wrong password
    $env:BW_PASSWORD = $p1
    $probe = (bw unlock --passwordenv BW_PASSWORD --raw 2>$null) | Out-String
    $env:BW_PASSWORD = $null
    if ([string]::IsNullOrWhiteSpace($probe)) { Fail "Bitwarden rejected that password. Nothing was stored." }

    $s1 | ConvertFrom-SecureString | Set-Content -Path $StoreFile -Encoding ASCII
    # readable only by the current user
    icacls $StoreFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
    Write-Host "Stored. Future unlocks are silent." -ForegroundColor Green
}

$pw = Read-StoredPassword
if (-not $pw) {
    Store-Password
    $pw = Read-StoredPassword
    if (-not $pw) { Fail "Could not read back the stored password." }
}

$env:BW_PASSWORD = $pw
$session = (bw unlock --passwordenv BW_PASSWORD --raw 2>$null) | Out-String
$env:BW_PASSWORD = $null
$session = $session.Trim()

if ([string]::IsNullOrWhiteSpace($session)) {
    Write-Error "bw-unlock: unlock failed. If you changed your master password, delete $StoreFile and run this again."
    exit 1
}

Write-Output $session
