<#
  نصب سیستم حضور و غیاب فرازهنر به‌عنوان Windows Service با NSSM
  ================================================================
  دقیقاً مطابق مدلی که در پروژه OrderSync قبلی شرکت استفاده شده (سند فاز ۹، بند «دیپلوی»):
  یک سرویس NSSM که src/index.js را اجرا می‌کند (هم API/HTTPS و هم بات Telegram Polling
  در همین یک پروسه بالا می‌آیند - نیازی به دو سرویس جدا نیست).

  پیش‌نیازها (باید از قبل روی سرور آماده باشند):
    1. Node.js نسخه ۱۸ یا بالاتر نصب شده باشد (node -v را چک کنید).
    2. NSSM دانلود و در PATH باشد یا مسیر nssm.exe را در پارامتر -NssmPath بدهید.
       دانلود: https://nssm.cc/download
    3. `npm install` در پوشه‌ی پروژه اجرا شده باشد (node_modules ساخته شده باشد).
    4. فایل .env کامل و صحیح پر شده باشد (به‌خصوص ADMIN_SESSION_SECRET,
       TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, SSL_CERT_PATH/SSL_KEY_PATH).
    5. این اسکریپت باید با دسترسی Administrator اجرا شود (نصب/راه‌اندازی سرویس ویندوز
       نیاز به دسترسی ادمین دارد).

  استفاده (از PowerShell با دسترسی Run as Administrator):
    cd "C:\path\to\Attendance System"
    powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1

  برای حذف کامل سرویس (مثلاً قبل از نصب مجدد):
    powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1 -Uninstall
#>

param(
  [string]$ServiceName = "FarazHonarAttendance",
  [string]$NssmPath = "nssm.exe",   # اگر NSSM در PATH نیست، مسیر کامل nssm.exe را اینجا بدهید
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

# مسیر ریشه‌ی پروژه = یک پوشه بالاتر از scripts\ (همین جایی که این فایل در آن است)
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
$EntryPoint = Join-Path $ProjectRoot "src\index.js"
$LogDir = Join-Path $ProjectRoot "logs"

function Test-NssmAvailable {
  try {
    & $NssmPath 2>&1 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-NssmAvailable)) {
  Write-Error "nssm.exe پیدا نشد. یا آن را در PATH قرار دهید یا با -NssmPath مسیر کامل را بدهید. دانلود: https://nssm.cc/download"
  exit 1
}

if ($Uninstall) {
  Write-Host "در حال متوقف و حذف سرویس '$ServiceName'..." -ForegroundColor Yellow
  & $NssmPath stop $ServiceName 2>&1 | Out-Null
  & $NssmPath remove $ServiceName confirm
  Write-Host "سرویس '$ServiceName' حذف شد." -ForegroundColor Green
  exit 0
}

if (-not $NodeExe) {
  Write-Error "Node.js پیدا نشد. مطمئن شوید Node.js نصب شده و در PATH سیستم است (node -v را تست کنید)."
  exit 1
}

if (-not (Test-Path $EntryPoint)) {
  Write-Error "فایل ورودی پیدا نشد: $EntryPoint - آیا این اسکریپت داخل پوشه‌ی scripts\ همین پروژه است؟"
  exit 1
}

if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
  Write-Warning "پوشه‌ی node_modules پیدا نشد. قبل از ادامه، در پوشه‌ی پروژه دستور 'npm install' را اجرا کنید."
}

if (-not (Test-Path (Join-Path $ProjectRoot ".env"))) {
  Write-Warning "فایل .env پیدا نشد. سرویس بدون .env کامل بالا نمی‌آید (به‌خصوص در NODE_ENV=production)."
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Write-Host "در حال نصب سرویس '$ServiceName'..." -ForegroundColor Cyan
Write-Host "  Node.js: $NodeExe"
Write-Host "  Entry point: $EntryPoint"
Write-Host "  Working directory: $ProjectRoot"

# اگر سرویس از قبل وجود دارد، اول حذفش می‌کنیم تا نصب تمیز باشد (idempotent)
& $NssmPath status $ServiceName 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Host "سرویس از قبل وجود دارد - متوقف و بازنصب می‌شود..." -ForegroundColor Yellow
  & $NssmPath stop $ServiceName 2>&1 | Out-Null
  & $NssmPath remove $ServiceName confirm 2>&1 | Out-Null
}

& $NssmPath install $ServiceName $NodeExe $EntryPoint
& $NssmPath set $ServiceName AppDirectory $ProjectRoot

# اجرای خودکار هنگام بوت سرور
& $NssmPath set $ServiceName Start SERVICE_AUTO_START

# لاگ‌های stdout/stderr پروسه (جدا از console.log های داخل برنامه که به همین‌ها می‌روند)
& $NssmPath set $ServiceName AppStdout (Join-Path $LogDir "service-stdout.log")
& $NssmPath set $ServiceName AppStderr (Join-Path $LogDir "service-stderr.log")
# چرخش خودکار لاگ (روزانه) تا فایل لاگ نامحدود بزرگ نشود
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateOnline 1
& $NssmPath set $ServiceName AppRotateSeconds 86400
& $NssmPath set $ServiceName AppRotateBytes 10485760

# راه‌اندازی مجدد خودکار در صورت کرش (throttle: اگر خیلی سریع پشت‌سرهم کرش کرد، فاصله بیندازد)
& $NssmPath set $ServiceName AppExit Default Restart
& $NssmPath set $ServiceName AppThrottle 1500
& $NssmPath set $ServiceName AppRestartDelay 3000

# خاموشی مرتب: به پروسه فرصت بده تا با SIGINT/SIGTERM (که server.js برایش handler دارد) جواب بدهد
& $NssmPath set $ServiceName AppStopMethodSkip 6      # از روش‌های Console/Window صرف‌نظر کن
& $NssmPath set $ServiceName AppStopMethodConsole 3000

& $NssmPath set $ServiceName Description "سیستم حضور و غیاب تلگرامی فرازهنر - بک‌اند API + Bot (Polling)"

Write-Host ""
Write-Host "سرویس نصب شد. برای شروع:" -ForegroundColor Green
Write-Host "  nssm start $ServiceName"
Write-Host "برای بررسی وضعیت:"
Write-Host "  nssm status $ServiceName"
Write-Host "یا از services.msc استفاده کنید (نام سرویس: $ServiceName)"
Write-Host ""
Write-Host "لاگ‌ها در این مسیر نوشته می‌شوند: $LogDir"
