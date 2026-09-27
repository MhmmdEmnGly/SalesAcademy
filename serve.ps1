# Yerel test sunucusu: siteyi http://localhost:8000 adresinde açar.
# index.html, data.json'u fetch ile okuduğu için dosyaya çift tıklayarak (file://) açılamaz.
# Kullanım: bu klasörde PowerShell açıp  .\serve.ps1  (durdurmak için Ctrl+C)
param([int]$Port = 8000, [switch]$NoBrowser)

$root = $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Satış Akademisi test sunucusu: http://localhost:$Port  (durdurmak için Ctrl+C)"
if (-not $NoBrowser) { Start-Process "http://localhost:$Port" }
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($rel -eq '') { $rel = 'index.html' }
    $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
    $res = $ctx.Response
    if ($path.StartsWith($root) -and (Test-Path $path -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($path)
      $ext = [IO.Path]::GetExtension($path).ToLower()
      $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-cache')
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
    }
    $res.Close()
  }
} finally {
  $listener.Stop()
}
