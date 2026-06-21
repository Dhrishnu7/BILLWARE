@
$text = Get-Content "live_report2.html" -Raw
$stack = New-Object System.Collections.Generic.List[Object]
$lines = $text -split "`n"

for ($i=0; $i -lt $lines.Length; $i++) {
    $line = $lines[$i]
    for ($j=0; $j -lt $line.Length; $j++) {
        $char = $line[$j]
        if ($char -in "{","[","(") {
            $stack.Add(@($char, ($i+1), ($j+1)))
        } elseif ($char -in "}","]",")") {
            if ($stack.Count -eq 0) {
                Write-Host "Extra closing $char at line $($i+1)"
            } else {
                $top = $stack[$stack.Count-1]
                $stack.RemoveAt($stack.Count-1)
                $expected = ""
                if ($top[0] -eq "{") { $expected = "}" }
                if ($top[0] -eq "[") { $expected = "]" }
                if ($top[0] -eq "(") { $expected = ")" }
                
                if ($char -ne $expected) {
                    Write-Host "Mismatch at line $($i+1): expected $expected but got $char. Opened at line $($top[1])"
                }
            }
        }
    }
}
foreach ($item in $stack) {
    Write-Host "Unclosed $($item[0]) opened at line $($item[1])"
}
@
