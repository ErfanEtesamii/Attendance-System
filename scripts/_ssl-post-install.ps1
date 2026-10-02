<#
  اسکریپت کمکی - توسط win-acme بعد از صدور/تمدید موفق گواهی صدا زده می‌شود
  (از setup-ssl-renewal.ps1 با --script/--scriptparameters ثبت می‌شود؛ معمولاً نباید
  مستقیم اجرا شود، ولی دستی هم قابل اجراست اگر فقط می‌خواهید .env را sync کنید و
  سرویس را ری‌استارت کنید بدون صدور مجدد گواهی).

  کاری که می‌کند:
    ۱. SSL_CERT_PATH و SSL_KEY_PATH را در .env به مسیر فایل‌های واقعی .pem آپدیت می‌کند
       (اگر از قبل با همین مقدار باشند، تغییری نمی‌دهد - idempotent).
    ۲. سرویس NSSM را ری‌استارت می‌کند تا Node.js گواهی جدید را لود کند
       (چون server.js فایل گواهی را فقط هنگام بالا آمدن می‌خواند، نه به‌صورت زنده).
#>

param(
  [Parameter(Mandatory = $true)][string]$CertDir,
  [Parameter(Mandatory = $true)][string]$EnvPath,
  [Parameter(Mandatory = $true)][string]$ServiceName,
  [string]$Domain = "attendance.farazhonar.com"
)

$ErrorActionPreference = "Stop"

$CertFile = Join-Path $CertDir "$Domain-chain.pem"
$KeyFile = Join-Path $CertDir "$Domain-key.pem"

if (-not (Test-Path $CertFile) -or -not (Test-Path $KeyFile)) {
  Write-Warning "فایل‌های گواهی مورد انتظار پیدا نشدند ($CertFile / $KeyFile) - .env تغییر داده نشد."
  exit 1
}

if (-not (Test-Path $EnvPath)) {
  Write-Error ".env پیدا نشد: $EnvPath"
  exit 1
}

$envContent = Get-Content -Path $EnvPath -Raw

function Set-EnvValue {
  param([string]$Content, [string]$Key, [string]$Value)
  $escapedValue = $Value -replace '\\', '\\\\'
  if ($Content -match "(?m)^$Key=.*$") {
    return ($Content -replace "(?m)^$Key=.*$", "$Key=$escapedValue")
  } else {
    return "$Content`r`n$Key=$escapedValue`r`n"
  }
}

$envContent = Set-EnvValue -Content $envContent -Key "SSL_CERT_PATH" -Value $CertFile
$envContent = Set-EnvValue -Content $envContent -Key "SSL_KEY_PATH" -Value $KeyFile

Set-Content -Path $EnvPath -Value $envContent -NoNewline
Write-Host "SSL_CERT_PATH/SSL_KEY_PATH در .env به‌روزرسانی شد." -ForegroundColor Green

try {
  & nssm restart $ServiceName
  Write-Host "سرویس '$ServiceName' ری‌استارت شد تا گواهی جدید لود شود." -ForegroundColor Green
} catch {
  Write-Warning "ری‌استارت خودکار سرویس ناموفق بود؛ دستی اجرا کنید: nssm restart $ServiceName"
}
