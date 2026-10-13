<?php
/**
 * SMS & WhatsApp for one school – platform owner page (standalone, no layout).
 * @var \App\View\AppView $this
 * @var array $school  @var array $platform  @var array $providers  @var array $history
 * @var string|null $notice  @var string|null $error  @var string $csrfToken
 */
$h       = static fn($v) => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
$selfUrl = $this->Url->build(['controller' => 'PlatformMessaging', 'action' => 'school', $school['code']]);
$listUrl = $this->Url->build(['controller' => 'PlatformMessaging', 'action' => 'index']);
$csrf    = '<input type="hidden" name="_csrfToken" value="' . $h($csrfToken) . '">';
$chName  = ['sms' => 'SMS', 'whatsapp' => 'WhatsApp'];
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= $h($school['code']) ?> – SMS &amp; WhatsApp</title>
<?= $this->element('trials_style') ?>
<style> .small { font-size:12px; color:var(--muted); } </style>
</head>
<body>
<div class="wrap">
  <h1><?= $h($school['name']) ?> <span class="small">(<?= $h($school['code']) ?>)</span></h1>
  <p class="sub">SMS &amp; WhatsApp · <?= $school['billing'] === 'subscription' ? 'International (subscription)' : 'Indian (legacy)' ?> school ·
     <a href="<?= $h($listUrl) ?>">← All schools</a></p>

  <?php if ($notice): ?><div class="msg ok"><?= $h($notice) ?></div><?php endif; ?>
  <?php if ($error): ?><div class="msg err"><?= $h($error) ?></div><?php endif; ?>

  <div class="card">
    <h2>1. Paid add-on</h2>
    <form method="post" action="<?= $h($selfUrl) ?>" class="form-row"><?= $csrf ?>
      <input type="hidden" name="op" value="addon"><input type="hidden" name="on" value="<?= $school['addon'] ? '0' : '1' ?>">
      <div><?= $school['addon'] ? '<span class="badge b-paid">On</span> The school can use SMS and WhatsApp.' : '<span class="badge b-ended">Off</span> Setup › Notifications › SMS &amp; WhatsApp is locked in the app.' ?></div>
      <button class="btn <?= $school['addon'] ? 'danger' : '' ?>"><?= $school['addon'] ? 'Switch off' : 'Switch on' ?></button>
    </form>
    <p class="hint"><?= $school['billing'] === 'subscription' ? 'Saved as the plan feature "messaging".' : 'Saved as the product module "messaging".' ?>
      Push notifications and e-mail are always free.</p>
  </div>

  <div class="grid2">
  <?php foreach (['sms', 'whatsapp'] as $ch): $c = $school['channels'][$ch]; $p = $platform[$ch]; ?>
    <div class="card">
      <h2>2. <?= $chName[$ch] ?></h2>
      <div class="kv"><span>How the school sends now</span><span><?= ['off' => 'Off', 'own' => 'Its own account' . ($c['provider'] ? ' (' . $h($providers[$c['provider']]['name'] ?? $c['provider']) . ')' : ''), 'managed' => "ManageMyAcademy's account"][$c['mode']] ?? $h($c['mode']) ?></span></div>
      <div class="kv"><span>Used this month on your account</span><span><?= (int)$c['used_managed'] ?> of <?= (int)$c['effective_allowance'] ?><?= $c['cost_managed'] > 0 ? ' · ' . $h($c['cost_managed'] . ' ' . $p['currency']) : '' ?></span></div>
      <?php if ($c['mode'] === 'own'): ?><div class="kv"><span>Sent on its own account this month</span><span><?= (int)$c['used_own'] ?></span></div><?php endif; ?>
      <?php if (!$p['set']): ?>
        <p class="hint">ManageMyAcademy's <?= $chName[$ch] ?> account is not set up yet – <a href="<?= $h($listUrl) ?>?edit=<?= $ch ?>">set it up</a>.</p>
      <?php endif; ?>
      <form method="post" action="<?= $h($selfUrl) ?>" style="margin-top:12px"><?= $csrf ?>
        <input type="hidden" name="op" value="channel"><input type="hidden" name="channel" value="<?= $ch ?>">
        <label><input type="checkbox" name="managed" value="1" <?= $c['mode'] === 'managed' ? 'checked' : '' ?> <?= $p['set'] ? '' : 'disabled' ?>>
          Send this school's <?= $chName[$ch] ?> through ManageMyAcademy's account</label>
        <div class="form-row" style="margin-top:8px">
          <div><label>Messages per month</label>
            <input type="number" name="allowance" min="0" value="<?= $c['allowance'] !== null ? (int)$c['allowance'] : '' ?>" placeholder="Default <?= (int)$p['default_allowance'] ?>" style="width:160px"></div>
          <button class="btn" type="submit">Save</button>
        </div>
        <p class="hint">Empty = your default allowance. The school's owner / admin get a message at 80% and when it runs out; the app notification and e-mail still go.
          <?= $c['mode'] === 'own' ? 'Ticking the box replaces the school\'s own account for this channel.' : '' ?></p>
      </form>
    </div>
  <?php endforeach; ?>
  </div>

  <div class="card">
    <h2>Last 6 months</h2>
    <table>
      <tr><th>Month</th><th>SMS (yours)</th><th>WhatsApp (yours)</th><th>SMS (own)</th><th>WhatsApp (own)</th></tr>
      <?php foreach ($history as $m => $r): ?>
      <tr><td><?= $h(date('M Y', strtotime($m . '-01'))) ?></td>
        <td><?= (int)($r['sms']['managed']['n'] ?? 0) ?><?= !empty($r['sms']['managed']['cost']) ? ' · ' . $h($r['sms']['managed']['cost']) : '' ?></td>
        <td><?= (int)($r['whatsapp']['managed']['n'] ?? 0) ?><?= !empty($r['whatsapp']['managed']['cost']) ? ' · ' . $h($r['whatsapp']['managed']['cost']) : '' ?></td>
        <td><?= (int)($r['sms']['own']['n'] ?? 0) ?></td><td><?= (int)($r['whatsapp']['own']['n'] ?? 0) ?></td></tr>
      <?php endforeach; ?>
      <?php if (!$history): ?><tr><td colspan="5" class="small">Nothing sent yet.</td></tr><?php endif; ?>
    </table>
  </div>

  <p class="hint">After switching the add-on on, the school chooses its events in the app (Setup › Notifications › What is sent). When you send its messages through your account,
    it does not need to enter any keys; it only sees your account, its allowance and this month's use.</p>
</div>
</body>
</html>
