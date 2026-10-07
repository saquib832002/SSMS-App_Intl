<?php
/**
 * Billing page (standalone – no layout).
 * @var array $status  @var array $plans  @var bool $isAdmin
 * @var string $schoolName  @var string|null $notice  @var string|null $error  @var string $csrfToken
 */
use App\Service\Entitlements;

$isSub   = ($status['billingModel'] ?? 'legacy') === 'subscription';
$sub     = $status['subscription'] ?? null;
$fmtDate = static fn($d) => $d ? date('j M Y', strtotime((string)$d)) : '—';
$fmtPrice = static function (?int $minor, string $cur, string $interval): string {
    if ($minor === null) {
        return 'Price coming soon';
    }
    return number_format($minor / 100, 2) . ' ' . strtoupper($cur) . ' / ' . $interval;
};
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Subscription – ManageMyAcademy</title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --brand:#1e40af; --bg:#f8fafc; --ok:#15803d; --warn:#b45309; --err:#b91c1c; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--ink); }
  .wrap { max-width:920px; margin:0 auto; padding:24px 16px 48px; }
  h1 { font-size:22px; margin:0 0 4px; } .sub { color:var(--muted); margin:0 0 20px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:18px; margin-bottom:16px; }
  .msg { padding:12px 14px; border-radius:10px; margin-bottom:16px; font-size:14px; }
  .msg.ok { background:#dcfce7; color:var(--ok); } .msg.err { background:#fee2e2; color:var(--err); }
  .row { display:flex; justify-content:space-between; gap:12px; padding:6px 0; font-size:14px; border-bottom:1px solid #f1f5f9; }
  .row:last-child { border-bottom:0; } .row span:first-child { color:var(--muted); }
  .badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:12px; font-weight:700; background:#e0e7ff; color:var(--brand); }
  .badge.warn { background:#fef3c7; color:var(--warn); } .badge.err { background:#fee2e2; color:var(--err); }
  .plans { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:16px; }
  .plan h3 { margin:0 0 4px; font-size:18px; } .price { font-size:20px; font-weight:800; margin:8px 0; }
  .plan ul { padding-left:18px; margin:8px 0 16px; color:#334155; font-size:14px; line-height:1.6; }
  button { width:100%; border:0; border-radius:10px; padding:12px; font-size:15px; font-weight:700; cursor:pointer; background:var(--brand); color:#fff; }
  button.secondary { background:#eff6ff; color:var(--brand); }
  button[disabled] { opacity:.5; cursor:not-allowed; }
  .note { color:var(--muted); font-size:13px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Subscription</h1>
  <p class="sub"><?= h($schoolName ?: 'Your school') ?></p>

  <?php if ($notice): ?><div class="msg ok"><?= h($notice) ?></div><?php endif; ?>
  <?php if ($error): ?><div class="msg err"><?= h($error) ?></div><?php endif; ?>

  <?php if (!$isSub): ?>
    <div class="card">
      <p>Your school is on the standard plan. Online subscription billing is not used for your account.
         Please contact support for renewals.</p>
    </div>
  <?php else: ?>

    <div class="card">
      <?php if ($sub): ?>
        <?php
          $st = $sub['status'];
          $cls = in_array($st, ['active', 'trialing'], true) ? '' : ($st === 'past_due' ? 'warn' : 'err');
        ?>
        <div class="row"><span>Plan</span><strong><?= h($sub['planName'] ?? '—') ?></strong></div>
        <div class="row"><span>Status</span><span class="badge <?= $cls ?>"><?= h(str_replace('_', ' ', $st)) ?></span></div>
        <div class="row"><span><?= $sub['cancelAtPeriodEnd'] ? 'Ends on' : 'Renews on' ?></span><span><?= h($fmtDate($sub['currentPeriodEnd'])) ?></span></div>
        <?php if ($st === 'past_due'): ?>
          <p class="note">Your last payment failed. Please update your payment method to keep access.</p>
        <?php endif; ?>
      <?php elseif (!empty($status['trialEndsAt'])): ?>
        <div class="row"><span>Status</span><span class="badge">Free trial</span></div>
        <div class="row"><span>Trial ends</span><span><?= h($fmtDate($status['trialEndsAt'])) ?></span></div>
        <p class="note">Choose a plan before the trial ends to keep using paid modules.
           Student registration and setup always stay free.</p>
      <?php else: ?>
        <div class="row"><span>Status</span><span class="badge warn">Free plan</span></div>
        <p class="note">Only student registration and setup are available. Choose a plan to unlock more modules.</p>
      <?php endif; ?>

      <?php if ($status['canManageBilling'] && $isAdmin): ?>
        <form method="post" action="<?= $this->Url->build('/billing/portal') ?>" style="margin-top:14px">
          <input type="hidden" name="_csrfToken" value="<?= h($csrfToken) ?>">
          <button type="submit" class="secondary">Manage billing (change plan, card, invoices, cancel)</button>
        </form>
      <?php endif; ?>
    </div>

    <?php if (!$status['hasActiveSubscription']): ?>
      <?php if (!$status['billingConfigured']): ?>
        <div class="msg err">Online payments are not set up yet. Please contact support.</div>
      <?php endif; ?>
      <div class="plans">
        <?php foreach ($plans as $plan): ?>
          <div class="card plan">
            <h3><?= h($plan['name']) ?></h3>
            <div class="note"><?= h((string)$plan['description']) ?></div>
            <div class="price"><?= h($fmtPrice($plan['priceMinor'], $plan['currency'], $plan['interval'])) ?></div>
            <ul>
              <li>Student registration &amp; setup (always free)</li>
              <?php foreach ($plan['modules'] as $m): ?>
                <li><?= h(Entitlements::label($m)) ?></li>
              <?php endforeach; ?>
            </ul>
            <?php if ($isAdmin): ?>
              <form method="post" action="<?= $this->Url->build('/billing/checkout') ?>">
                <input type="hidden" name="_csrfToken" value="<?= h($csrfToken) ?>">
                <input type="hidden" name="plan_code" value="<?= h($plan['planCode']) ?>">
                <button type="submit" <?= ($plan['available'] && $status['billingConfigured']) ? '' : 'disabled' ?>>
                  Choose <?= h($plan['name']) ?>
                </button>
              </form>
            <?php endif; ?>
          </div>
        <?php endforeach; ?>
      </div>
      <?php if (!$isAdmin): ?>
        <p class="note">Only the school owner or admin can choose a plan.</p>
      <?php endif; ?>
    <?php endif; ?>

    <p class="note">Payments are processed securely by Stripe. Prices may include applicable taxes.</p>
  <?php endif; ?>
</div>
</body>
</html>
