Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot 'icon'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function New-Master([int]$S, [double]$SwPx, [bool]$Small) {
  # 描边按最终像素反推（$SwPx 由调用方按目标尺寸算好）
  $sw = $SwPx
  $bmp = New-Object System.Drawing.Bitmap $S, $S, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $u = $S / 1024.0   # unit scale, design drawn on 1024 grid
  $P = { param($x,$y) [System.Drawing.PointF]::new($x * $u, $y * $u) }
  $R = { param($x,$y,$w,$h) [System.Drawing.RectangleF]::new($x * $u, $y * $u, $w * $u, $h * $u) }

  # ---- squircle tile ----
  $pad = 40 * $u; $size = (1024 - 80) * $u; $rad = 210 * $u
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $k = $rad * 2
  $gp.AddArc(($pad), ($pad), $k, $k, 180, 90)
  $gp.AddArc(($pad + $size - $k), ($pad), $k, $k, 270, 90)
  $gp.AddArc(($pad + $size - $k), ($pad + $size - $k), $k, $k, 0, 90)
  $gp.AddArc($pad, ($pad + $size - $k), $k, $k, 90, 90)
  $gp.CloseFigure()

  $gb = New-Object System.Drawing.Drawing2D.LinearGradientBrush( `
    [System.Drawing.PointF]::new($pad, $pad), `
    [System.Drawing.PointF]::new((1024 * $u) - $pad, (1024 * $u) - $pad), `
    [System.Drawing.Color]::FromArgb(255, 42, 18, 110), [System.Drawing.Color]::FromArgb(255, 8, 78, 190))
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend(4)
  $blend.Colors = @(
    [System.Drawing.Color]::FromArgb(255, 76, 29, 149),
    [System.Drawing.Color]::FromArgb(255, 37, 64, 190),
    [System.Drawing.Color]::FromArgb(255, 12, 118, 214),
    [System.Drawing.Color]::FromArgb(255, 34, 211, 238))
  $blend.Positions = @(0.0, 0.38, 0.72, 1.0)
  $gb.InterpolationColors = $blend
  $g.FillPath($gb, $gp)

  # ---- radial glow top-left ----
  $pgh = New-Object System.Drawing.Drawing2D.PathGradientBrush($gp)
  $pgh.CenterColor = [System.Drawing.Color]::FromArgb(120, 150, 220, 255)
  $pgh.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
  $pgh.CenterPoint = [System.Drawing.PointF]::new(330 * $u, 250 * $u)
  $pgh.SetBlendTriangularShape(0.55)
  $g.SetClip($gp)
  $g.FillRectangle($pgh, 0, 0, $S, $S)
  $g.ResetClip()

  function RoundRect([double]$x, [double]$y, [double]$w, [double]$h, [double]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
  }

  # ---- glow behind the sheets ----
  $glowRect = [System.Drawing.RectangleF]::new(212 * $u, 120 * $u, 600 * $u, 600 * $u)
  $gpGlow = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gpGlow.AddEllipse($glowRect)
  $pGB = New-Object System.Drawing.Drawing2D.PathGradientBrush($gpGlow)
  $pGB.CenterColor = [System.Drawing.Color]::FromArgb(150, 120, 235, 255)
  $pGB.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 120, 235, 255))
  $g.FillEllipse($pGB, $glowRect)

  # ---- folder back panel ----
  $back = RoundRect (205 * $u) (470 * $u) (614 * $u) (390 * $u) (46 * $u)
  $backBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush( `
    [System.Drawing.PointF]::new(205 * $u, 470 * $u), [System.Drawing.PointF]::new(819 * $u, 860 * $u), `
    [System.Drawing.Color]::FromArgb(235, 78, 96, 220), [System.Drawing.Color]::FromArgb(235, 132, 74, 226))
  $g.FillPath($backBrush, $back)
  $g.DrawPath((New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(160, 190, 235, 255), [float](5 * $sw * $u))), $back)

  # ---- stacked sheets (rise out of the folder) ----
  $sheetW = 330; $sheetH = 300
  $rot = @( -14, -5, 4 )
  $drk = @( 70, 120, 200 )
  if ($Small) { $rot = @( -10, 5 ); $drk = @( 150, 240 ) }
  $n = $drk.Count
  for ($i = 0; $i -lt $n; $i++) {
    $state = $g.Save()
    $cx = (512 + ($drk[$i] - 160) * 0.18) * $u
    $cy = (478 - $i * 26) * $u
    $g.TranslateTransform($cx, $cy)
    $g.RotateTransform($rot[$i])
    $r = RoundRect (-$sheetW / 2 * $u) (-$sheetH / 2 * $u) ($sheetW * $u) ($sheetH * $u) (26 * $u)
    $a = $drk[$i]
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush( `
      [System.Drawing.PointF]::new(0, -$sheetH / 2 * $u), [System.Drawing.PointF]::new(0, $sheetH / 2 * $u), `
      [System.Drawing.Color]::FromArgb([Math]::Min(255, $a + 55), 255, 255, 255), [System.Drawing.Color]::FromArgb($a, 205, 226, 255))
    $g.FillPath($brush, $r)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb([int]($a * 0.9), 220, 245, 255), [float](4 * $sw * $u))
    $g.DrawPath($pen, $r)
    # text lines on front sheet only
    if ($i -eq ($n - 1) -and -not $Small) {
      $lineBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(210, 40, 90, 200))
      $accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 34, 211, 238))
      $lp = RoundRect (-110 * $u) (-105 * $u) (150 * $u) (26 * $u) (13 * $u)
      $g.FillPath($accent, $lp)
      $widths = @(210, 175, 210, 130)
      for ($j = 0; $j -lt 4; $j++) {
        $ly = (-55 + $j * 46) * $u
        $lr = RoundRect (-110 * $u) $ly ($widths[$j] * $u) (20 * $u) (10 * $u)
        $g.FillPath($lineBrush, $lr)
      }
    }
    $g.Restore($state) | Out-Null
  }

  # ---- folder front flap (slanted, translucent cyan -> magenta) ----
  $body = New-Object System.Drawing.Drawing2D.GraphicsPath
  $body.AddPolygon([System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(258 * $u, 622 * $u),
    [System.Drawing.PointF]::new(766 * $u, 622 * $u),
    [System.Drawing.PointF]::new(872 * $u, 862 * $u),
    [System.Drawing.PointF]::new(152 * $u, 862 * $u)))
  $fbr = New-Object System.Drawing.Drawing2D.LinearGradientBrush( `
    [System.Drawing.PointF]::new(258 * $u, 622 * $u), [System.Drawing.PointF]::new(872 * $u, 862 * $u), `
    [System.Drawing.Color]::FromArgb(240, 34, 211, 238), [System.Drawing.Color]::FromArgb(230, 217, 70, 239))
  $g.FillPath($fbr, $body)
  $fpen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 240, 252, 255), [float](7 * $sw * $u))
  $g.DrawPath($fpen, $body)
  # bright crease along the flap top edge
  $crease = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(240, 255, 255, 255), [float](5 * $sw * $u))
  $g.DrawLine($crease, 258 * $u, 622 * $u, 766 * $u, 622 * $u)

  # ---- neon rim on the tile ----
  $rim = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(210, 140, 225, 255), [float](9 * $sw * $u))
  $g.DrawPath($rim, $gp)

  $g.Dispose()
  return $bmp
}

$masterBig = New-Master 1024 1 $false
foreach ($s in @(256, 128, 64, 48, 32, 24, 16)) {
  # 小尺寸单独出母版：4 倍分辨率绘制 + 按目标反推的粗描边，缩到目标后线条仍有约 1.6px
  $own = $null
  if ($s -ge 64) { $master = $masterBig } else {
    $mult = 1.6 * 1024 / (7 * $s)
    $own = New-Master ($s * 4) $mult $true
    $master = $own
  }
  $b = New-Object System.Drawing.Bitmap $s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gg = [System.Drawing.Graphics]::FromImage($b)
  $gg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $gg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $gg.DrawImage($master, (New-Object System.Drawing.Rectangle 0, 0, $s, $s))
  $gg.Dispose()
  $b.Save("$dir\icon-$s.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $b.Save("$dir\icon-$s.bmp", [System.Drawing.Imaging.ImageFormat]::Bmp)
  $b.Dispose()
  if ($own) { $own.Dispose() }
}
$masterBig.Save("$dir\icon-1024.png", [System.Drawing.Imaging.ImageFormat]::Png)
$masterBig.Dispose()
Write-Output "icon rendered"
