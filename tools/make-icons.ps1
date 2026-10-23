# tools/make-icons.ps1
# 由 icons/icon.svg 渲染全部图标：基础图标 + 三种状态色图标。
#
#   powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
#
# 设计说明：整枚图形全部由路径绘制，不含 <text>，所以渲染不依赖任何字体，
# 在任何机器上结果一致（旧版图标用 Playfair Display 衬线体，缺字体就会变形）。
#
# 改设计只改 icons/icon.svg 这一处，然后重跑本脚本即可。
# 想换底色：把 SVG 里的 #0969da 替换成目标色。
param(
  [string]$ImageMagick = 'magick'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$icons = Join-Path $root 'icons'
$svgPath = Join-Path $icons 'icon.svg'
$tmp = Join-Path $env:TEMP ('ghp-icons-' + [guid]::NewGuid().ToString('N'))

if (-not (Test-Path $svgPath)) { throw "缺少源文件：$svgPath" }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# 状态 -> 底色
$states = @(
  @{ key = 'on';   color = '#1a7f37'; desc = '运行中（绿色）' },
  @{ key = 'off';  color = '#656d76'; desc = '已停用（灰色）' },
  @{ key = 'fail'; color = '#cf222e'; desc = '镜像连续失败（红色）' }
)
$sizes = @(16, 32, 48, 128)
$base = '#0969da'

$svg = Get-Content $svgPath -Raw

function Render-Svg([string]$svgFile, [string]$outFile, [int]$size) {
  & $ImageMagick -background none $svgFile -resize "${size}x${size}" -depth 8 "PNG32:$outFile"
  if ($LASTEXITCODE -ne 0) { throw "渲染失败：$outFile" }
}

# ---- 基础图标（manifest 的 default_icon / icons）----
foreach ($size in $sizes) {
  Render-Svg $svgPath (Join-Path $icons "icon$size.png") $size
  Write-Host ("生成 {0,-14} 基础图标" -f "icon$size.png")
}

# ---- 状态图标（运行时按状态换色）----
foreach ($s in $states) {
  $colored = $svg -replace [regex]::Escape($base), $s.color
  $svgFile = Join-Path $tmp "$($s.key).svg"
  Set-Content -Path $svgFile -Value $colored -Encoding UTF8
  foreach ($size in $sizes) {
    $out = Join-Path $icons "state-$($s.key)-$size.png"
    Render-Svg $svgFile $out $size
    Write-Host ("生成 {0,-22} {1}" -f (Split-Path $out -Leaf), $s.desc)
  }
}

Remove-Item -Recurse -Force $tmp
Write-Host ''
Write-Host "完成。基础图标 $($sizes.Count) 个 + 状态图标 $($states.Count * $sizes.Count) 个。"
