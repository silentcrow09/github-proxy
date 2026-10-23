# tools/make-icons.ps1
# 由现有蓝色图标生成三种状态色的图标（运行/停用/失败）。
#
#   powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
#
# 为什么不重新渲染 icons/icon.svg：那份 SVG 用的 Playfair Display 字体本机没装，
# ImageMagick 会回退成无衬线体，"G" 的字形会变样。所以这里改的是**已有的 PNG**，
# 只换底色，字形原样保留。
#
# 换色用 -fuzz + -opaque：把底色蓝整体替换成目标色。
# -fuzz 30% 会一并吃掉 "G" 边缘的蓝白混合像素，使描边平滑过渡到新底色。
param(
  [string]$ImageMagick = 'magick'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$icons = Join-Path $root 'icons'

# 状态 -> 底色
$states = @(
  @{ key = 'on';   color = '#1a7f37'; desc = '运行中（绿色）' },
  @{ key = 'off';  color = '#656d76'; desc = '已停用（灰色）' },
  @{ key = 'fail'; color = '#cf222e'; desc = '镜像连续失败（红色）' }
)
$sizes = @(16, 32, 48, 128)
$fuzz = '30%'

foreach ($s in $states) {
  foreach ($size in $sizes) {
    $src = Join-Path $icons "icon$size.png"
    $dst = Join-Path $icons "state-$($s.key)-$size.png"
    if (-not (Test-Path $src)) { throw "缺少源图标：$src" }
    & $ImageMagick $src -fuzz $fuzz -fill $s.color -opaque '#0969da' $dst
    if ($LASTEXITCODE -ne 0) { throw "生成失败：$dst" }
    Write-Host ("生成 {0,-28} {1}" -f (Split-Path $dst -Leaf), $s.desc)
  }
}

Write-Host ''
Write-Host '完成。共生成' ($states.Count * $sizes.Count) '个状态图标。'
