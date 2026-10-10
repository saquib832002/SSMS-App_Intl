<?php
/**
 * Free trials – platform owner page (standalone, no layout).
 * @var \App\View\AppView $this
 * @var int $defaultDays  @var array $schools  @var array $counts  @var string $filter
 * @var string $search  @var array $history  @var string|null $notice  @var string|null $error
 * @var string $csrfToken
 */
$h       = static fn($v) => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
$fmt     = static fn($d) => $d ? date('j M Y', strtotime((string)$d)) : '—';
$selfUrl = $this->Url->build(['controller' => 'SsmsClients', 'action' => 'trials']);
$manage  = fn($code) => $this->Url->build(['controller' => 'SsmsClients', 'action' => 'manageTrial', $code]);
$stateBadge = static function (array $s) use ($fmt): string {
    switch ($s['state']) {
        case 'trial':
            $cls = $s['daysLeft'] <= 3 ? 'b-warn' : 'b-trial';
            return "<span class=\"badge {$cls}\">Trial · {$s['daysLeft']} day" . ($s['daysLeft'] == 1 ? '' : 's') . ' left</span>';
        case 'paid':
            return '<span class="badge b-paid">Paid' . ($s['paidPlan'] ? ' · ' . htmlspecialchars($s['paidPlan']) : '') . '</span>';
        default:
            return '<span class="badge b-ended">Trial ended</span>';
    }
};
$actionLabel = [
    'default_days' => 'Default trial length', 'extend' => 'Extended', 'set_date' => 'End date set',
    'end_now' => 'Ended now', 'restart' => 'Restarted', 'apply_default' => 'New default applied',
];
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Free trials – ManageMyAcademy</title>
<?= $this->element('trials_style') ?>
</head>
<body>
<div class="wrap">
  <h1>Free trials</h1>
  <p class="sub">International schools only. Indian schools are not affected. ·
     <a href="<?= $h($this->Url->build(['controller' => 'Dashboards', 'action' => 'superuserDashboard'])) ?>">← Back to dashboard</a></p>

  <?php if ($notice): ?><div class="msg ok"><?= $h($notice) ?></div><?php endif; ?>
  <?php if ($error): ?><div class="msg err"><?= $h($error) ?></div><?php endif; ?>

  <div class="card">
    <h2>Default trial length for new schools</h2>
    <form method="post" action="<?= $h($selfUrl) ?>">
      <input type="hidden" name="_csrfToken" value="<?= $h($csrfToken) ?>">
      <div class="form-row">
        <div>
          <label for="trial_days">Trial length (days)</label>
          <input type="number" id="trial_days" name="trial_days" min="1" max="365" required value="<?= (int)$defaultDays ?>" style="width:120px">
        </div>
        <div style="flex:1;min-width:220px">
          <label for="note">Note (optional)</label>
          <input type="text" id="note" name="note" maxlength="255" placeholder="e.g. Autumn promotion" style="width:100%">
        </div>
        <button class="btn" type="submit">Save</button>
      </div>
      <label style="margin-top:12px;display:flex;gap:8px;align-items:center;color:var(--ink)">
        <input type="checkbox" name="apply_current" value="1">
        Also apply to schools currently in trial (end date = registration date + new length; never earlier than today)
      </label>
      <p class="hint">Currently <strong><?= (int)$defaultDays ?> days</strong>. New registrations get this length immediately; the app's sign-up screen shows it too.</p>
    </form>
  </div>

  <div class="card">
    <h2>Schools</h2>
    <div class="tabs">
      <?php
        $tabs = ['' => 'All', 'trial' => "In trial ({$counts['trial']})", 'trial_ended' => "Trial ended ({$counts['trial_ended']})", 'paid' => "Paid ({$counts['paid']})"];
        foreach ($tabs as $k => $lbl):
          $url = $selfUrl . '?' . http_build_query(array_filter(['state' => $k, 'q' => $search]));
      ?>
        <a class="<?= $filter === $k ? 'on' : '' ?>" href="<?= $h($url) ?>"><?= $h($lbl) ?></a>
      <?php endforeach; ?>
      <form method="get" action="<?= $h($selfUrl) ?>" style="margin-left:auto;display:flex;gap:6px">
        <?php if ($filter !== ''): ?><input type="hidden" name="state" value="<?= $h($filter) ?>"><?php endif; ?>
        <input type="text" name="q" value="<?= $h($search) ?>" placeholder="Search code or name">
        <button class="btn ghost" type="submit">Search</button>
      </form>
    </div>
    <div class="scroll">
    <table>
      <thead><tr><th>School</th><th>Country</th><th>Registered</th><th>Trial ends</th><th>Status</th><th></th></tr></thead>
      <tbody>
      <?php if (!$schools): ?>
        <tr><td colspan="6" style="color:var(--muted)">No schools found.</td></tr>
      <?php endif; ?>
      <?php foreach ($schools as $s): ?>
        <tr>
          <td><strong><?= $h($s['code']) ?></strong><br><span style="color:var(--muted);font-size:13px"><?= $h($s['name']) ?></span></td>
          <td><?= $h($s['country'] ?: '—') ?></td>
          <td><?= $fmt($s['registeredOn']) ?></td>
          <td><?= $fmt($s['trialEnd']) ?></td>
          <td><?= $stateBadge($s) ?><?= $s['manualGrants'] ? ' <span class="badge b-warn">' . (int)$s['manualGrants'] . ' manual</span>' : '' ?></td>
          <td><a class="btn ghost" href="<?= $h($manage($s['code'])) ?>">Manage trial</a></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    </div>
  </div>

  <div class="card">
    <h2>Recent changes</h2>
    <div class="scroll">
    <table>
      <thead><tr><th>When</th><th>School</th><th>Change</th><th>From → To</th><th>Note</th><th>By</th></tr></thead>
      <tbody>
      <?php if (!$history): ?><tr><td colspan="6" style="color:var(--muted)">No changes yet.</td></tr><?php endif; ?>
      <?php foreach ($history as $c): ?>
        <tr>
          <td><?= $h(date('j M Y H:i', strtotime((string)$c['created_at']))) ?></td>
          <td><?= $h($c['ssms_client_code'] ?? 'All (default)') ?></td>
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
