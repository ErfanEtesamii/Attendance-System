<#
  صدور/تمدید خودکار گواهی SSL برای attendance.farazhonar.com با روش DNS-01
  ================================================================================
  ⚠️ قبل از اجرا حتماً بخش «نکته مهم درباره DNS-01» پایین همین فایل را بخوانید -
  این اسکریپت یک تمپلیت آماده‌ی اجراست، نه یک راه‌حل کاملاً plug-and-play، چون گام
  DNS-01 وابسته به این است که دامنه‌ی farazhonar.com واقعاً کجا (چه پنل/DNS provider‌ی)
  مدیریت می‌شود - چیزی که در اسناد این پروژه مشخص نشده (فقط این آمده که توصیه شده
  MikroTik به‌عنوان DNS *داخلی* شبکه تنظیم شود؛ آن یک موضوع کاملاً جداست، پایین توضیح داده شده).

  چرا win-acme (wacs.exe) و نه certbot: این سرور Windows است (نه Linux)، و win-acme
  ابزار استاندارد Let's Encrypt روی ویندوز است؛ خروجی PFX/PEM را مستقیم در مسیری که
  SSL_CERT_PATH/SSL_KEY_PATH انتظار دارند می‌گذارد و خودش Scheduled Task تمدید می‌سازد.
  دانلود: https://www.win-acme.com/ (نسخه‌ی pluggable یا trimmed، فایل wacs.exe).

  کاری که این اسکریپت انجام می‌دهد:
    1. wacs.exe را (اگر در PATH/مسیر داده‌شده باشد) برای صدور گواهی attendance.farazhonar.com
       با DNS-01 صدا می‌زند (--store پیش‌فرض pemfiles، خروجی .pem قابل‌استفاده مستقیم توسط Node).
    2. مسیر فایل‌های .pem خروجی را در .env (SSL_CERT_PATH/SSL_KEY_PATH) می‌نویسد.
    3. سرویس NSSM را ری‌استارت می‌کند تا گواهی جدید لود شود.
    4. یک Scheduled Task روزانه می‌سازد که خودش را با --renew دوباره صدا بزند (idempotent:
       win-acme فقط وقتی گواهی واقعاً نزدیک انقضا باشد کاری انجام می‌دهد).

  استفاده (Run as Administrator، یک‌بار برای صدور اولیه):
    cd "C:\path\to\Attendance System"
    powershell -ExecutionPolicy Bypass -File .\scripts\setup-ssl-renewal.ps1 -WacsPath "C:\win-acme\wacs.exe"

  اجرای بعدی‌ها (توسط Scheduled Task، خودکار):
    wacs.exe --renew --baseuri "https://acme-v02.api.letsencrypt.org/"
#>

param(
  [string]$Domain = "attendance.farazhonar.com",
  [string]$WacsPath = "wacs.exe",
  [string]$ServiceName = "FarazHonarAttendance",
  [switch]$SkipScheduledTask
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnvPath = Join-Path $ProjectRoot ".env"
$CertOutDir = Join-Path $ProjectRoot "ssl"

function Test-WacsAvailable {
  try { & $WacsPath --version 2>&1 | Out-Null; return $true } catch { return $false }
}

if (-not (Test-WacsAvailable)) {
  Write-Error "wacs.exe پیدا نشد. آن را از https://www.win-acme.com/ دانلود کنید و با -WacsPath مسیرش را بدهید."
  exit 1
}

New-Item -ItemType Directory -Force -Path $CertOutDir | Out-Null

Write-Host "در حال صدور/تمدید گواهی برای $Domain با DNS-01..." -ForegroundColor Cyan
Write-Host "⚠️ اگر اولین اجراست، win-acme به‌صورت تعاملی روش DNS-01 (کدام DNS provider) را می‌پرسد." -ForegroundColor Yellow
Write-Host "   اگر پلاگین DNS provider واقعی دامنه شما نصب/پیکربندی نشده، این مرحله را دستی انجام دهید:" -ForegroundColor Yellow
Write-Host "   TXT record با نامی که win-acme می‌دهد (_acme-challenge.$Domain) را در پنل DNS واقعی" -ForegroundColor Yellow
Write-Host "   دامنه (جایی که farazhonar.com ثبت/مدیریت می‌شود) بسازید، سپس Enter بزنید." -ForegroundColor Yellow
Write-Host ""

& $WacsPath --target manual --host $Domain --validation dns-01 `
  --store pemfiles --pemfilespath $CertOutDir `
  --installation script `
  --script (Join-Path $PSScriptRoot "_ssl-post-install.ps1") `
  --scriptparameters "-CertDir `"$CertOutDir`" -EnvPath `"$EnvPath`" -ServiceName `"$ServiceName`""

$CertFile = Join-Path $CertOutDir "$Domain-chain.pem"
$KeyFile = Join-Path $CertOutDir "$Domain-key.pem"

if (-not (Test-Path $CertFile) -or -not (Test-Path $KeyFile)) {
  Write-Warning "فایل‌های گواهی در مسیر مورد انتظار پیدا نشدند ($CertFile / $KeyFile)."
  Write-Warning "خروجی واقعی win-acme را چک کنید (ممکن است نام فایل با نسخه‌ی wacs.exe شما کمی فرق کند)"
  Write-Warning "و SSL_CERT_PATH/SSL_KEY_PATH را در .env دستی تنظیم کنید."
} else {
  Write-Host "گواهی صادر شد: $CertFile" -ForegroundColor Green
}

if (-not $SkipScheduledTask) {
  $TaskName = "FarazHonarAttendance-SSLRenew"
  $Action = New-ScheduledTaskAction -Execute $WacsPath -Argument "--renew --baseuri `"https://acme-v02.api.letsencrypt.org/`""
  # هر روز ساعت ۳ بامداد چک می‌کند؛ win-acme فقط نزدیک انقضا واقعاً تمدید می‌کند (پیش‌فرض: ۳۰ روز قبل)
  $Trigger = New-ScheduledTaskTrigger -Daily -At 3am
  $Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Force | Out-Null
  Write-Host "Scheduled Task '$TaskName' ساخته شد (چک روزانه ساعت ۳ بامداد)." -ForegroundColor Green
}

Write-Host ""
Write-Host "پایان. اگر گواهی با موفقیت صادر شد، اسکریپت کمکی _ssl-post-install.ps1 به‌صورت خودکار" -ForegroundColor Cyan
Write-Host ".env را به‌روزرسانی و سرویس '$ServiceName' را ری‌استارت کرده است."

<#
  ===================================================================================
  نکته مهم درباره DNS-01 (حتماً بخوانید)
  ===================================================================================
  دو DNS کاملاً متفاوت در این پروژه مطرح است - نباید با هم اشتباه شوند:

  ۱. DNS *داخلی* شبکه شرکت (پیشنهاد سند: MikroTik به‌عنوان DNS Server داخلی) -
     فقط برای این‌که کارمندان داخل شبکه وقتی attendance.farazhonar.com را در مرورگر/تلگرام
     می‌زنند، به IP داخلی سرور (192.168.10.2) resolve شود. این به فرآیند صدور گواهی
     هیچ ربطی ندارد.

  ۲. DNS *عمومی* دامنه farazhonar.com (هرجا این دامنه ثبت/مدیریت می‌شود - رجیستراری مثل
     ثبت‌آنلاین/IRNIC یا هر DNS provider دیگری که شرکت استفاده می‌کند) - این همان‌جایی‌ست
     که Let's Encrypt برای DNS-01 انتظار دارد یک رکورد TXT موقت با نام
     _acme-challenge.attendance.farazhonar.com ظاهر شود. این اسکریپت این DNS provider را
     نمی‌شناسد (چون در اسناد پروژه مشخص نشده کدام است)، پس win-acme به‌صورت پیش‌فرض به
     حالت manual/تعاملی می‌افتد: خودش رکورد لازم را نشان می‌دهد، شما دستی در پنل DNS واقعی
     دامنه می‌سازید، بعد Enter می‌زنید تا صدور کامل شود.

  برای تمدید کاملاً خودکار (بدون دخالت دستی هر ۹۰ روز)، دو راه دارید:
    الف) اگر DNS provider دامنه یکی از پلاگین‌های رسمی win-acme را دارد (Cloudflare،
         Route53، DigitalOcean، TransIP و ده‌ها مورد دیگر - لیست کامل:
         https://www.win-acme.com/reference/plugins/validation)، همان پلاگین را نصب و
         در دستور --validation از dns-01 ساده به همان پلاگین (مثلاً --validation cloudflare
         با --cloudflareapitoken) تغییر دهید تا کاملاً خودکار شود.
    ب) اگر DNS provider پلاگین آماده ندارد ولی API دارد، از win-acme's script validation
       استفاده کنید (--validation dns-01 --dnscreatescript / --dnsdeletescript) و دو
       اسکریپت کوچک بنویسید که با API آن provider رکورد TXT را بسازد/پاک کند.
  تا وقتی یکی از این دو راه پیاده نشود، تمدید هر ۹۰ روز نیاز به یک دخالت دستی چند دقیقه‌ای
  دارد (ساخت رکورد TXT) - که باز هم بسیار کمتر از فرآیند کاملاً دستی گرفتن گواهی است.
#>
