<?php
/**
 * Public fee payment page (no layout).
 * @var array $p  @var array $school  @var array $items  @var array|null $rzp
 * @var string|null $error  @var string $goUrl  @var string $rzpPost  @var string $selfUrl
 */
$h     = static fn($v) => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
// Language & formats: the family's own language (else the school's), the school's number and date formats
$__c   = (string)$p['ssms_client_code'];
$__L   = \App\Service\Locale::class;
$__prev = $__L::useLang($__L::langForEmail($__c, '', $p['enrollment_id'] ?? null));
$t     = static fn(string $en, array $v = []) => $__L::t($__c, $en, $v);
$money = static fn($v) => $__L::number($__c, (float)$v) . ' ' . $p['currency'];
$rtl   = $__L::isRtl($__c);
$name  = (string)($school['ssms_client_header_text'] ?? $p['ssms_client_code']);
$paid  = $p['status'] === 'paid';
$open  = $p['status'] === 'pending' && (int)$p['is_expired'] !== 1;
?>
<!doctype html>
<html lang="<?= $h($__L::lang($__c)) ?>"<?= $rtl ? ' dir="rtl"' : '' ?>>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title><?= $h($t('Pay fees')) ?> – <?= $h($name) ?></title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --brand:#1e40af; --bg:#f8fafc; --ok:#15803d; --err:#b91c1c; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--ink); }
  .wrap { max-width:520px; margin:0 auto; padding:24px 16px 40px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:16px; padding:20px; margin-bottom:14px; }
  h1 { font-size:20px; margin:0 0 2px; } .sub { color:var(--muted); font-size:14px; margin:0 0 4px; }
  .row { display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid #f1f5f9; font-size:14px; }
  .row:last-child { border-bottom:0; } .row span:first-child { color:#334155; }
  .total { display:flex; justify-content:space-between; font-size:18px; font-weight:800; margin-top:12px; }
  .btn { display:block; width:100%; text-align:center; border:0; border-radius:12px; padding:15px; font-size:16px; font-weight:800; cursor:pointer; background:var(--brand); color:#fff; text-decoration:none; margin-top:16px; }
  .msg { padding:12px 14px; border-radius:10px; margin-bottom:14px; font-size:14px; }
  .ok { background:#dcfce7; color:var(--ok); } .err { background:#fee2e2; color:var(--err); }
  .small { color:var(--muted); font-size:12px; text-align:center; margin-top:12px; }
  .big { font-size:40px; text-align:center; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1><?= $h($name) ?></h1>
    <p class="sub"><?= $h($t('Fee payment for')) ?> <strong><?= $h($p['student_name'] ?: $t('Enrollment #{id}', ['id' => $p['enrollment_id']])) ?></strong></p>
  </div>

  <?php if ($error): ?><div class="msg err"><?= $h($error) ?></div><?php endif; ?>

  <?php if ($paid): ?>
    <div class="card">
      <div class="big">✅</div>
      <h1 style="text-align:center"><?= $h($t('Payment received')) ?></h1>
      <p class="sub" style="text-align:center"><?= $h($t('Receipt')) ?> <?= $h($p['receipt_number']) ?> · <?= $money($p['amount']) ?></p>
      <p class="small"><?= $h($t('The school will confirm it in their records. You can close this page and return to the app.')) ?></p>
    </div>
  <?php elseif (!$open): ?>
    <div class="card">
      <h1><?= $h($t('This link has expired')) ?></h1>
      <p class="sub"><?= $h($t('Please open the app and tap “Pay online” again, or ask the school for a new link.')) ?></p>
    </div>
  <?php else: ?>
    <div class="card">
      <?php foreach ($items as $it): ?>
        <div class="row"><span><?= $h($it['fee_item_name'] ?: $t('Fee #{id}', ['id' => $it['fee_item_id']])) ?></span><span><?= $money($it['balance_due']) ?></span></div>
      <?php endforeach; ?>
      <div class="total"><span><?= $h($t('Total')) ?></span><span><?= $money($p['amount']) ?></span></div>

      <?php if ($p['provider'] === 'stripe'): ?>
        <a class="btn" href="<?= $h($goUrl) ?>"><?= $h($t('Pay {amount}', ['amount' => $money($p['amount'])])) ?></a>
        <p class="small"><?= $h($t('Secure payment by Stripe. Card, Apple Pay and Google Pay accepted where available.')) ?></p>
      <?php elseif ($rzp): ?>
        <button class="btn" id="rzp-btn" type="button"><?= $h($t('Pay {amount}', ['amount' => $money($p['amount'])])) ?></button>
        <form id="rzp-form" method="post" action="<?= $h($rzpPost) ?>" style="display:none">
          <input type="hidden" name="razorpay_payment_id" id="rzp_pid">
          <input type="hidden" name="razorpay_order_id" id="rzp_oid">
          <input type="hidden" name="razorpay_signature" id="rzp_sig">
        </form>
        <p class="small"><?= $h($t('Secure payment by Razorpay. UPI, cards, net banking and wallets accepted.')) ?></p>
        <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
        <script>
          (function () {
            var opts = <?= json_encode([
                'key'         => $rzp['keyId'],
                'amount'      => $rzp['amount'],
                'currency'    => $rzp['currency'],
                'order_id'    => $rzp['orderId'],
                'name'        => $name,
                'description' => $t('School fees') . ' – ' . ($p['student_name'] ?: ''),
                'theme'       => ['color' => '#1e40af'],
            ], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>;
            opts.handler = function (r) {
              document.getElementById('rzp_pid').value = r.razorpay_payment_id;
              document.getElementById('rzp_oid').value = r.razorpay_order_id;
              document.getElementById('rzp_sig').value = r.razorpay_signature;
              document.getElementById('rzp-form').submit();
            };
            var rzp = new Razorpay(opts);
            rzp.on('payment.failed', function (r) { alert((r.error && r.error.description) || <?= json_encode($t('Payment failed. Please try again.'), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>); });
            document.getElementById('rzp-btn').onclick = function () { rzp.open(); };
          })();
        </script>
      <?php endif; ?>
    </div>
    <p class="small"><?= $h($t('Link valid until {date}.', ['date' => $__L::date($__c, (string)$p['expires_at'], 'medium')])) ?></p>
  <?php endif; ?>
</div>
</body>
</html>
<?php $__L::endLang($__prev); ?>
