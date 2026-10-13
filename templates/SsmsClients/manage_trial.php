<?php
/**
 * Manage one school's free trial (standalone, no layout).
 * @var \App\View\AppView $this
 * @var array $school  @var int $defaultDays  @var array $history
 * @var string|null $notice  @var string|null $error  @var string $csrfToken
 */
$h       = static fn($v) => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
$fmt     = static fn($d) => $d ? date('j M Y', strtotime((string)$d)) : '—';
$selfUrl = $this->Url->build(['controller' => 'SsmsClients', 'action' => 'manageTrial', $school['code']]);
$listUrl = $this->Url->build(['controller' => 'SsmsClients', 'action' => 'trials']);
$state   = [
    'trial'       => '<span class="badge ' . (($school['daysLeft'] ?? 99) <= 3 ? 'b-warn' : 'b-trial') . '">In trial · ' . (int)$school['daysLeft'] . ' day(s) left</span>',
    'trial_ended' => '<span class="badge b-ended">Trial ended</span>',
    'paid'        => '<span class="badge b-paid">Paid' . ($school['paidPlan'] ? ' · ' . $h($school['paidPlan']) : '') . '</span>',
    'legacy'      => '<span class="badge b-warn">Indian (legacy) school – no trial</span>',
][$school['state']] ?? '';
$actionLabel = [
    'default_days' => 'Default trial length', 'extend' => 'Extended', 'set_date' => 'End date set',
    'end_now' => 'Ended now', 'restart' => 'Restarted', 'apply_default' => 'New default applied',
    'edit_client' => 'Changed on Edit client page',
];
$isSub = $school['billingModel'] === 'subscription';
$csrf  = '<input type="hidden" name="_csrfToken" value="' . $h($csrfToken) . '">';
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trial – <?= $h($school['code']) ?> – ManageMyAcademy</title>
<?= $this->element('trials_style') ?>
</head>
<body>
<div class="wrap">
  <p class="sub"><a href="<?= $h($listUrl) ?>">← All free trials</a></p>
  <h1><?= $h($school['name'] ?: $school['code']) ?> <span style="color:var(--muted);font-weight:400">(<?= $h($school['code']) ?>)</span></h1>
  <p class="sub"><?= $state ?></p>

  <?php if ($notice): ?><div class="msg ok"><?= $h($notice) ?></div><?php endif; ?>
  <?php if ($error): ?><div class="msg err"><?= $h($error) ?></div><?php endif; ?>

  <div class="card">
    <div class="kv"><span>Registered</span><span><?= $fmt($school['registeredOn']) ?></span></div>
    <div class="kv"><span>Country</span><span><?= $h($school['country'] ?: '—') ?></span></div>
    <div class="kv"><span>Trial end date</span><span><strong><?= $fmt($school['trialEnd']) ?></strong></span></div>
    <div class="kv"><span>Paid plan</span><span><?= $school['paidPlan'] ? $h($school['paidPlan']) . ' until ' . $fmt($school['paidUntil']) : '—' ?></span></div>
    <div class="kv"><span>Manual grants</span><span><?= (int)$school['manualGrants'] ?></span></div>
    <p class="hint">During the trial the school can use every paid feature. Paid (Google Play) and manually granted features are never removed by these actions.</p>
  </div>

  <?php if ($isSub): ?>
  <div class="grid2">
    <div class="card">
      <h2>Extend trial</h2>
      <form method="post" action="<?= $h($selfUrl) ?>"><?= $csrf ?>
        <input type="hidden" name="op" value="extend">
        <div class="form-row">
          <div><label>Add days</label><input type="number" name="days" min="1" max="365" value="30" required style="width:100px"></div>
          <div><label>Counting from</label>
            <select name="from"><option value="end">Current end date</option><option value="today">Today</option></select></div>
        </div>
        <div style="margin-top:10px"><label>Note (optional)</label><input type="text" name="note" maxlength="255" style="width:100%"></div>
        <div style="margin-top:12px"><button class="btn" type="submit">Extend</button></div>
      </form>
    </div>

    <div class="card">
      <h2>Set exact end date</h2>
      <form method="post" action="<?= $h($selfUrl) ?>"><?= $csrf ?>
        <input type="hidden" name="op" value="set_date">
        <div><label>Trial ends on (inclusive)</label><input type="date" name="end_date" required value="<?= $h($school['trialEnd'] ?? '') ?>"></div>
        <div style="margin-top:10px"><label>Note (optional)</label><input type="text" name="note" maxlength="255" style="width:100%"></div>
        <div style="margin-top:12px"><button class="btn" type="submit">Save date</button></div>
      </form>
    </div>

    <div class="card">
      <h2>Restart trial</h2>
      <form method="post" action="<?= $h($selfUrl) ?>"><?= $csrf ?>
        <input type="hidden" name="op" value="restart">
        <div><label>New trial length (days, starting today)</label>
          <input type="number" name="days" min="1" max="365" value="<?= (int)$defaultDays ?>" style="width:100px"></div>
        <div style="margin-top:10px"><label>Note (optional)</label><input type="text" name="note" maxlength="255" style="width:100%"></div>
        <div style="margin-top:12px"><button class="btn ghost" type="submit">Start new trial</button></div>
      </form>
    </div>

    <div class="card">
      <h2>End trial now</h2>
      <form method="post" action="<?= $h($selfUrl) ?>" onsubmit="return confirm('End the free trial for <?= $h($school['code']) ?> now?');"><?= $csrf ?>
        <input type="hidden" name="op" value="end_now">
        <p class="hint" style="margin-top:0">Trial features lock immediately. Paid and manual features stay.</p>
        <div><label>Note (optional)</label><input type="text" name="note" maxlength="255" style="width:100%"></div>
        <div style="margin-top:12px"><button class="btn danger" type="submit">End trial now</button></div>
      </form>
    </div>
  </div>
  <?php endif; ?>

  <div class="card">
    <h2>History</h2>
    <div class="scroll">
    <table>
      <thead><tr><th>When</th><th>Change</th><th>From → To</th><th>Note</th><th>By</th></tr></thead>
      <tbody>
      <?php if (!$history): ?><tr><td colspan="5" style="color:var(--muted)">No changes yet.</td></tr><?php endif; ?>
      <?php foreach ($history as $c): ?>
        <tr>
          <td><?= $h(date('j M Y H:i', strtotime((string)$c['created_at']))) ?></td>
          <td><?= $h($actionLabel[$c['action']] ?? $c['action']) ?></td>
          <td><?= $h(($c['old_value'] ?: '—') . ' → ' . ($c['new_value'] ?: '—')) ?></td>
          <td><?= $h($c['note']) ?></td>
          <td><?= $h($c['changed_by']) ?></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    </div>
  </div>
</div>
</body>
</html>
