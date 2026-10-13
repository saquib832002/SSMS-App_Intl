<?php
/** @var string $title  @var string $text */
$h = static fn($v) => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title><?= $h($title) ?> – ManageMyAcademy</title>
<style>
  body { margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:#f8fafc; color:#0f172a; }
  .wrap { max-width:520px; margin:0 auto; padding:40px 16px; }
  .card { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:24px; }
  h1 { font-size:20px; margin:0 0 8px; } p { color:#475569; font-size:15px; line-height:1.5; margin:0; }
</style>
</head>
<body>
<div class="wrap"><div class="card"><h1><?= $h($title) ?></h1><p><?= $h($text) ?></p></div></div>
</body>
</html>
