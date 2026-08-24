$ErrorActionPreference = "Stop"

$repository = "Aidamirrrrrr/sddc"
$installDir = if ($env:SDDC_INSTALL_DIR) {
  $env:SDDC_INSTALL_DIR
} else {
  Join-Path $env:LOCALAPPDATA "sddc\bin"
}
$asset = "sddc-windows-x64.exe"
$baseUrl = "https://github.com/$repository/releases/latest/download"
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) "sddc-$([guid]::NewGuid())"

New-Item -ItemType Directory -Force -Path $temporary, $installDir | Out-Null
try {
  Write-Host "Downloading $asset..."
  Invoke-WebRequest "$baseUrl/$asset" -OutFile "$temporary\$asset"
  Invoke-WebRequest "$baseUrl/checksums.txt" -OutFile "$temporary\checksums.txt"

  $checksumLine = Get-Content "$temporary\checksums.txt" |
    Where-Object { $_ -match "\s(?:artifacts/)?$([regex]::Escape($asset))$" } |
    Select-Object -First 1
  if (-not $checksumLine) { throw "Checksum for $asset is missing." }
  $expected = $checksumLine.Split()[0]
  $actual = (Get-FileHash "$temporary\$asset" -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected.ToLowerInvariant()) { throw "Checksum verification failed." }

  $destination = Join-Path $installDir "sddc.exe"
  Copy-Item "$temporary\$asset" $destination -Force
  & $destination --init
  Write-Host "Installed sddc to $destination"
  if (($env:PATH -split ";") -notcontains $installDir) {
    Write-Host "Add $installDir to PATH, then run: sddc --help"
  }
} finally {
  Remove-Item $temporary -Recurse -Force -ErrorAction SilentlyContinue
}
