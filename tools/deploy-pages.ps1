# Update the GitHub Pages website (run after editing files in public/)
$tmp = "$env:TEMP\saathi-gh-pages"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp | Out-Null
Copy-Item -Recurse "$PSScriptRoot\..\public\*" $tmp
Push-Location $tmp
if (-not (Test-Path "$tmp\.git")) {
  git init -b gh-pages | Out-Null
  git config user.name "rajeev8980"
  git config user.email "rajeev.kumar8980@gmail.com"
  git remote add origin https://github.com/rajeev8980/saathi.git
}
git add -A
git commit -m "Update website $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-Null
git push -f origin gh-pages
Pop-Location
Write-Output "Deployed to https://rajeev8980.github.io/saathi/"
