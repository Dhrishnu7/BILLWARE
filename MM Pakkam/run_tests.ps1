$reportFile = "test_output.txt"
"Broken Links & Missing Assets" | Out-File $reportFile
"=============================" | Out-File $reportFile -Append

$htmlFiles = Get-ChildItem -Path . -Recurse -Filter *.html
foreach ($file in $htmlFiles) {
    $content = Get-Content $file.FullName -Raw
    $matches = [regex]::Matches($content, 'href=["''](.*?)["'']|src=["''](.*?)["'']')
    foreach ($match in $matches) {
        $link = if ($match.Groups[1].Value) { $match.Groups[1].Value } else { $match.Groups[2].Value }
        
        if ($link -match "^http|^mailto:|^tel:|^#|^//|^\s*$") { continue }
        
        $cleanLink = $link -replace "\?.*$", ""
        $cleanLink = $cleanLink -replace "#.*$", ""
        
        if ($cleanLink -eq "" -or $cleanLink -eq "/") { continue }
        
        # Handle absolute paths from root (assuming current dir is root)
        if ($cleanLink.StartsWith("/")) {
            $cleanLink = $cleanLink.Substring(1)
            $targetPath = Join-Path (Get-Location) $cleanLink
        } else {
            $targetPath = Join-Path $file.DirectoryName $cleanLink
        }
        
        if (-not (Test-Path $targetPath)) {
            "File: $($file.Name) -> Broken link: $link" | Out-File $reportFile -Append
        }
    }
}

"Empty Alt Attributes" | Out-File $reportFile -Append
"====================" | Out-File $reportFile -Append
foreach ($file in $htmlFiles) {
    $content = Get-Content $file.FullName -Raw
    if ($content -match '<img[^>]*alt=["'']\s*["''][^>]*>') {
        "File: $($file.Name) contains images with empty alt attributes." | Out-File $reportFile -Append
    }
}
