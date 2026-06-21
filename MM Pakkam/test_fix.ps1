$text = "â”€â”€"
$cp1252 = [System.Text.Encoding]::GetEncoding(1252)
$utf8 = [System.Text.Encoding]::UTF8
$bytes = $cp1252.GetBytes($text)
$recoveredText = $utf8.GetString($bytes)
[System.IO.File]::WriteAllText("c:\Users\dhris\OneDrive\Documents\GitHub\MM\MM-Pakkam\MM Pakkam\test_output.txt", $recoveredText, $utf8)
