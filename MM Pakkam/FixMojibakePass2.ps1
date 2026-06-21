$files = Get-ChildItem -Filter *.html -Recurse

function DecodeBytes($bytes) { return [System.Text.Encoding]::UTF8.GetString($bytes) }
function EncodeCP1252($bytes) { return [System.Text.Encoding]::GetEncoding(1252).GetString($bytes) }

$replacements = @()
$replacements += @{ Orig = EncodeCP1252([byte[]](0xE2, 0x88, 0x92)); New = DecodeBytes([byte[]](0xE2, 0x88, 0x92)) } # −
$replacements += @{ Orig = EncodeCP1252([byte[]](0xE2, 0x95, 0x90)); New = DecodeBytes([byte[]](0xE2, 0x95, 0x90)) } # ═
$replacements += @{ Orig = EncodeCP1252([byte[]](0xE2, 0x96, 0xBC)); New = DecodeBytes([byte[]](0xE2, 0x96, 0xBC)) } # ▼
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x94, 0xB4)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x94, 0xB4)) } # 🔴
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x9F, 0xA0)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x9F, 0xA0)) } # 🟠
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x9F, 0xA1)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x9F, 0xA1)) } # 🟡
$replacements += @{ Orig = EncodeCP1252([byte[]](0xE2, 0x9C, 0x85)); New = DecodeBytes([byte[]](0xE2, 0x9C, 0x85)) } # ✅
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x96, 0xA8, 0xEF, 0xB8, 0x8F)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x96, 0xA8, 0xEF, 0xB8, 0x8F)) } # 🖨️
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x93, 0xA5)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x93, 0xA5)) } # 📥
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x8E, 0x89)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x8E, 0x89)) } # 🎉
$replacements += @{ Orig = EncodeCP1252([byte[]](0xE2, 0x86, 0x92)); New = DecodeBytes([byte[]](0xE2, 0x86, 0x92)) } # →

$utf8Encoding = [System.Text.Encoding]::UTF8

foreach ($file in $files) {
    $content = [System.IO.File]::ReadAllText($file.FullName, $utf8Encoding)
    $changed = $false
    
    foreach ($rep in $replacements) {
        if ($content.Contains($rep.Orig)) {
            $content = $content.Replace($rep.Orig, $rep.New)
            $changed = $true
        }
    }
    
    if ($changed) {
        [System.IO.File]::WriteAllText($file.FullName, $content, $utf8Encoding)
        Write-Host "Fixed $($file.Name)"
    }
}
