$files = Get-ChildItem -Filter *.html -Recurse
$utf8 = [System.Text.Encoding]::UTF8
$cp1252 = [System.Text.Encoding]::GetEncoding(1252)

$replacements = @(
    @{ Orig = $cp1252.GetString($utf8.GetBytes("──")); New = "──" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("👥")); New = "👥" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("…")); New = "…" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("—")); New = "—" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("✓")); New = "✓" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("🔑")); New = "🔑" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("👋")); New = "👋" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("💵")); New = "💵" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("📈")); New = "📈" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("📦")); New = "📦" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("🛒")); New = "🛒" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("📄")); New = "📄" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("🔍")); New = "🔍" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("➕")); New = "➕" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("🗑")); New = "🗑" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("🚚")); New = "🚚" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("👨‍⚕️")); New = "👨‍⚕️" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("💊")); New = "💊" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("₹")); New = "₹" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("“")); New = "“" },
    @{ Orig = $cp1252.GetString($utf8.GetBytes("”")); New = "”" }
)

foreach ($file in $files) {
    $contentBytes = [System.IO.File]::ReadAllBytes($file.FullName)
    $content = $utf8.GetString($contentBytes)
    $changed = $false
    
    foreach ($rep in $replacements) {
        if ($content.Contains($rep.Orig)) {
            $content = $content.Replace($rep.Orig, $rep.New)
            $changed = $true
        }
    }
    
    if ($changed) {
        [System.IO.File]::WriteAllText($file.FullName, $content, $utf8)
        Write-Host "Fixed $($file.Name)"
    }
}
