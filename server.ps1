$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Web
Add-Type -AssemblyName System.Net.Http

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$HostAddress = '127.0.0.1'
$Port = 8765
$DefaultApiUrl = 'https://script.google.com/macros/s/AKfycbxf5sgRpnMaiU8lWPJ_0_n34jaJgc1-pKUnyjf5d7nvAIP5v0hF_ZRss-NJru5zLnux/exec'
$ConfigPath = Join-Path $ScriptDir 'config.json'

# Auto-find the folder containing index.html.
$candidates = New-Object System.Collections.Generic.List[string]
$candidates.Add($ScriptDir)

$parent = Split-Path -Parent $ScriptDir
if ($parent) { $candidates.Add($parent) }

$grandParent = if ($parent) { Split-Path -Parent $parent } else { $null }
if ($grandParent) { $candidates.Add($grandParent) }

try {
    $cwd = (Get-Location).Path
    if ($cwd) { $candidates.Add($cwd) }
} catch {}

$WebRoot = $null
foreach ($candidate in $candidates | Select-Object -Unique) {
    if (Test-Path -LiteralPath (Join-Path $candidate 'index.html') -PathType Leaf) {
        $WebRoot = [System.IO.Path]::GetFullPath($candidate)
        break
    }
}

if (-not $WebRoot) {
    throw "index.html was not found. Put server.ps1 and START_DOCLOCK_FIXED.bat in the same folder as index.html, or in its immediate subfolder."
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Get-Config {
    if (Test-Path $ConfigPath) {
        try {
            $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if (-not $config.apiUrl) { $config | Add-Member -NotePropertyName apiUrl -NotePropertyValue $DefaultApiUrl }
            if (-not $config.token) { throw 'Token is empty.' }
            return $config
        } catch {
            Write-Host ''
            Write-Host '[ERROR] config.json cannot be read. It will be recreated.' -ForegroundColor Red
            Remove-Item -LiteralPath $ConfigPath -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Host ''
    Write-Host 'First setup: paste only the characters after JOB_ADMIN_TOKEN=' -ForegroundColor Cyan
    $token = Read-Host 'JOB_ADMIN_TOKEN'
    if ([string]::IsNullOrWhiteSpace($token)) {
        throw 'JOB_ADMIN_TOKEN cannot be empty.'
    }

    $configObject = [ordered]@{
        apiUrl = $DefaultApiUrl
        token  = $token.Trim()
    }
    Write-Utf8NoBom -Path $ConfigPath -Text ($configObject | ConvertTo-Json)
    Write-Host 'Token saved locally in config.json.' -ForegroundColor Green
    return [pscustomobject]$configObject
}

function Send-Bytes {
    param(
        [System.Net.Sockets.NetworkStream]$Stream,
        [int]$StatusCode,
        [string]$Reason,
        [string]$ContentType,
        [byte[]]$Body
    )

    if ($null -eq $Body) { $Body = [byte[]]@() }
    $header = "HTTP/1.1 $StatusCode $Reason`r`n" +
              "Content-Type: $ContentType`r`n" +
              "Content-Length: $($Body.Length)`r`n" +
              "Cache-Control: no-store`r`n" +
              "Connection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($Body.Length -gt 0) {
        $Stream.Write($Body, 0, $Body.Length)
    }
    $Stream.Flush()
}

function Send-Text {
    param(
        [System.Net.Sockets.NetworkStream]$Stream,
        [int]$StatusCode,
        [string]$Reason,
        [string]$ContentType,
        [string]$Text
    )
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    Send-Bytes -Stream $Stream -StatusCode $StatusCode -Reason $Reason -ContentType $ContentType -Body $bytes
}

function Get-MimeType([string]$FilePath) {
    switch ([System.IO.Path]::GetExtension($FilePath).ToLowerInvariant()) {
        '.html' { return 'text/html; charset=utf-8' }
        '.js'   { return 'text/javascript; charset=utf-8' }
        '.css'  { return 'text/css; charset=utf-8' }
        '.json' { return 'application/json; charset=utf-8' }
        '.png'  { return 'image/png' }
        '.jpg'  { return 'image/jpeg' }
        '.jpeg' { return 'image/jpeg' }
        '.svg'  { return 'image/svg+xml' }
        '.ico'  { return 'image/x-icon' }
        default { return 'application/octet-stream' }
    }
}

function Build-UpstreamGetUrl([string]$Target, $Config) {
    $incoming = [System.Uri]("http://localhost$Target")
    $incomingQuery = [System.Web.HttpUtility]::ParseQueryString($incoming.Query)

    $builder = New-Object System.UriBuilder($Config.apiUrl)
    $upstreamQuery = [System.Web.HttpUtility]::ParseQueryString($builder.Query)

    foreach ($key in $incomingQuery.AllKeys) {
        if ($null -ne $key -and $key -ne 'token') {
            $upstreamQuery[$key] = $incomingQuery[$key]
        }
    }

    if ($upstreamQuery['action'] -eq 'all') {
        $upstreamQuery['token'] = [string]$Config.token
    }

    $builder.Query = $upstreamQuery.ToString()
    return $builder.Uri.AbsoluteUri
}

function Handle-Api {
    param(
        [string]$Method,
        [string]$Target,
        [string]$Body,
        [System.Net.Sockets.NetworkStream]$Stream,
        $Config,
        [System.Net.Http.HttpClient]$HttpClient
    )

    try {
        if ($Method -eq 'GET') {
            $url = Build-UpstreamGetUrl -Target $Target -Config $Config
            $response = $HttpClient.GetAsync($url).GetAwaiter().GetResult()
        }
        elseif ($Method -eq 'POST') {
            $form = [System.Web.HttpUtility]::ParseQueryString($Body)
            $form['token'] = [string]$Config.token
            $content = [System.Net.Http.StringContent]::new(
                $form.ToString(),
                [System.Text.Encoding]::UTF8,
                'application/x-www-form-urlencoded'
            )
            $response = $HttpClient.PostAsync([string]$Config.apiUrl, $content).GetAwaiter().GetResult()
        }
        else {
            Send-Text -Stream $Stream -StatusCode 405 -Reason 'Method Not Allowed' -ContentType 'application/json; charset=utf-8' -Text '{"ok":false,"message":"Method not allowed"}'
            return
        }

        $responseBytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        $contentType = 'application/json; charset=utf-8'
        if ($response.Content.Headers.ContentType) {
            $contentType = $response.Content.Headers.ContentType.ToString()
        }

        Send-Bytes -Stream $Stream `
            -StatusCode ([int]$response.StatusCode) `
            -Reason ([string]$response.ReasonPhrase) `
            -ContentType $contentType `
            -Body $responseBytes
    }
    catch {
        $message = ($_.Exception.Message -replace '"', '\"')
        Send-Text -Stream $Stream -StatusCode 500 -Reason 'Internal Server Error' -ContentType 'application/json; charset=utf-8' -Text "{`"ok`":false,`"message`":`"$message`"}"
    }
}

function Handle-Static {
    param(
        [string]$Target,
        [System.Net.Sockets.NetworkStream]$Stream
    )

    $uri = [System.Uri]("http://localhost$Target")
    $requestPath = [System.Uri]::UnescapeDataString($uri.AbsolutePath)
    if ($requestPath -eq '/') { $requestPath = '/index.html' }

    $relativePath = $requestPath.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $WebRoot $relativePath))
    $rootPrefix = [System.IO.Path]::GetFullPath($WebRoot).TrimEnd('\') + '\'

    if (-not $fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Send-Text -Stream $Stream -StatusCode 403 -Reason 'Forbidden' -ContentType 'application/json; charset=utf-8' -Text '{"ok":false,"message":"Forbidden"}'
        return
    }

    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        Send-Text -Stream $Stream -StatusCode 404 -Reason 'Not Found' -ContentType 'application/json; charset=utf-8' -Text ('{"ok":false,"message":"File not found","webRoot":"' + ($WebRoot -replace '\\','\\\\') + '"}')
        return
    }

    $bytes = [System.IO.File]::ReadAllBytes($fullPath)
    Send-Bytes -Stream $Stream -StatusCode 200 -Reason 'OK' -ContentType (Get-MimeType $fullPath) -Body $bytes
}

function Handle-Client {
    param(
        [System.Net.Sockets.TcpClient]$TcpClient,
        $Config,
        [System.Net.Http.HttpClient]$HttpClient
    )

    $stream = $TcpClient.GetStream()
    $reader = New-Object System.IO.StreamReader(
        $stream,
        [System.Text.Encoding]::ASCII,
        $false,
        8192,
        $true
    )

    $requestLine = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($requestLine)) { return }

    $parts = $requestLine.Split(' ')
    if ($parts.Length -lt 2) { return }

    $method = $parts[0].ToUpperInvariant()
    $target = $parts[1]
    $headers = @{}

    while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq '') { break }
        $separator = $line.IndexOf(':')
        if ($separator -gt 0) {
            $headers[$line.Substring(0, $separator).Trim().ToLowerInvariant()] =
                $line.Substring($separator + 1).Trim()
        }
    }

    $body = ''
    if ($headers.ContainsKey('content-length')) {
        $length = [int]$headers['content-length']
        if ($length -gt 0) {
            $buffer = New-Object char[] $length
            $read = 0
            while ($read -lt $length) {
                $count = $reader.Read($buffer, $read, $length - $read)
                if ($count -le 0) { break }
                $read += $count
            }
            if ($read -gt 0) { $body = -join $buffer[0..($read - 1)] }
        }
    }

    if ($target.StartsWith('/job-api')) {
        Handle-Api -Method $method -Target $target -Body $body -Stream $stream -Config $Config -HttpClient $HttpClient
    }
    else {
        Handle-Static -Target $target -Stream $stream
    }
}

try {
    $config = Get-Config

    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $true
    $httpClient = New-Object System.Net.Http.HttpClient($handler)
    $httpClient.Timeout = [System.TimeSpan]::FromSeconds(35)

    $listener = New-Object System.Net.Sockets.TcpListener(
        [System.Net.IPAddress]::Parse($HostAddress),
        $Port
    )
    $listener.Start()

    Write-Host ''
    Write-Host '===============================================' -ForegroundColor Green
    Write-Host ' Doclick local system is running' -ForegroundColor Green
    Write-Host (" Web root: " + $WebRoot) -ForegroundColor Cyan
    Write-Host " http://$HostAddress`:$Port/index.html" -ForegroundColor Cyan
    Write-Host ' Keep this window open while using the system.' -ForegroundColor Yellow
    Write-Host '===============================================' -ForegroundColor Green
    Write-Host ''

    Start-Process "http://$HostAddress`:$Port/index.html"

    while ($true) {
        $tcpClient = $listener.AcceptTcpClient()
        try {
            Handle-Client -TcpClient $tcpClient -Config $config -HttpClient $httpClient
        }
        catch {
            Write-Host ("Request error: " + $_.Exception.Message) -ForegroundColor Red
        }
        finally {
            $tcpClient.Close()
        }
    }
}
catch {
    Write-Host ''
    Write-Host ('[ERROR] ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host ''
    Read-Host 'Press Enter to close'
}
