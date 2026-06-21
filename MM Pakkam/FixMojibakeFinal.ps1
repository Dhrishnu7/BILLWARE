$files = Get-ChildItem -Filter *.html -Recurse

function DecodeBytes($bytes) {
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function EncodeCP1252($bytes) {
    return [System.Text.Encoding]::GetEncoding(1252).GetString($bytes)
}

$replacements = @()
$replacements += @{ Orig = EncodeCP1252([byte[]](0xE2, 0x94, 0x80)); New = DecodeBytes([byte[]](0xE2, 0x94, 0x80)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x91, 0xA5)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x91, 0xA5)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xE2, 0x80, 0xA6)); New = DecodeBytes([byte[]](0xE2, 0x80, 0xA6)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xE2, 0x80, 0x94)); New = DecodeBytes([byte[]](0xE2, 0x80, 0x94)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xE2, 0x9C, 0x93)); New = DecodeBytes([byte[]](0xE2, 0x9C, 0x93)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x94, 0x91)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x94, 0x91)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x91, 0x8B)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x91, 0x8B)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x92, 0xB5)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x92, 0xB5)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x93, 0x88)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x93, 0x88)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x93, 0xA6)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x93, 0xA6)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x9B, 0x92)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x9B, 0x92)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x93, 0x84)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x93, 0x84)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x94, 0x8D)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x94, 0x8D)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xE2, 0x9E, 0x95)); New = DecodeBytes([byte[]](0xE2, 0x9E, 0x95)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x97, 0x91)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x97, 0x91)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x9A, 0x9A)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x9A, 0x9A)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x91, 0xA8, 0xE2, 0x80, 0x8D, 0xE2, 0x9A, 0x95, 0xEF, 0xB8, 0x8F)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x91, 0xA8, 0xE2, 0x80, 0x8D, 0xE2, 0x9A, 0x95, 0xEF, 0xB8, 0x8F)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xF0, 0x9F, 0x92, 0x8A)); New = DecodeBytes([byte[]](0xF0, 0x9F, 0x92, 0x8A)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xE2, 0x82, 0xB9)); New = DecodeBytes([byte[]](0xE2, 0x82, 0xB9)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xE2, 0x80, 0x9C)); New = DecodeBytes([byte[]](0xE2, 0x80, 0x9C)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xE2, 0x80, 0x9D)); New = DecodeBytes([byte[]](0xE2, 0x80, 0x9D)) }
$replacements += @{ Orig = EncodeCP1252([byte[]](0xEF, 0xB8, 0x8F)); New = DecodeBytes([byte[]](0xEF, 0xB8, 0x8F)) }

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
