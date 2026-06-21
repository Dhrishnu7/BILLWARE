$files = Get-ChildItem -Filter *.html -Recurse
$utf8 = [System.Text.Encoding]::UTF8

function Get-Mojibake ($str) {
    $bytes = $utf8.GetBytes($str)
    return [System.Text.Encoding]::GetEncoding(1252).GetString($bytes)
}

$replacements = @(
    @{ Orig = Get-Mojibake "──"; New = "──" },
    @{ Orig = Get-Mojibake "👥"; New = "👥" },
    @{ Orig = Get-Mojibake "…"; New = "…" },
    @{ Orig = Get-Mojibake "—"; New = "—" },
    @{ Orig = Get-Mojibake "✓"; New = "✓" },
    @{ Orig = Get-Mojibake "🔑"; New = "🔑" },
    @{ Orig = Get-Mojibake "👋"; New = "👋" },
    @{ Orig = Get-Mojibake "💵"; New = "💵" },
    @{ Orig = Get-Mojibake "📈"; New = "📈" },
    @{ Orig = Get-Mojibake "📦"; New = "📦" },
    @{ Orig = Get-Mojibake "🛒"; New = "🛒" },
    @{ Orig = Get-Mojibake "📄"; New = "📄" },
    @{ Orig = Get-Mojibake "🔍"; New = "🔍" },
    @{ Orig = Get-Mojibake "➕"; New = "➕" },
    @{ Orig = Get-Mojibake "🗑"; New = "🗑" },
    @{ Orig = Get-Mojibake "🚚"; New = "🚚" },
    @{ Orig = Get-Mojibake "👨‍⚕️"; New = "👨‍⚕️" },
    @{ Orig = Get-Mojibake "💊"; New = "💊" },
    @{ Orig = Get-Mojibake "₹"; New = "₹" },
    @{ Orig = Get-Mojibake "“"; New = "“" },
    @{ Orig = Get-Mojibake "”"; New = "”" }
)

foreach ($file in $files) {
    $content = [System.IO.File]::ReadAllText($file.FullName, $utf8)
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
