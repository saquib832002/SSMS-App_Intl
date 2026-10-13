<?php
/**
 * SMS & WhatsApp – platform owner page (standalone, no layout).
 * @var \App\View\AppView $this
 * @var array $platform  @var array $providers  @var array $schools  @var string $search
 * @var string|null $notice  @var string|null $error  @var string $edit  @var string $csrfToken
 */
$h       = static fn($v) => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
$selfUrl = $this->Url->build(['controller' => 'PlatformMessaging', 'action' => 'index']);
$csrf    = '<input type="hidden" name="_csrfToken" value="' . $h($csrfToken) . '">';
$chName  = ['sms' => 'SMS', 'whatsapp' => 'WhatsApp'];
$modeTxt = ['off' => '<span class="badge b-ended">Off</span>', 'own' => '<span class="badge b-trial">Own account</span>', 'managed' => '<span class="badge b-paid">ManageMyAcademy</span>'];
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SMS &amp; WhatsApp – ManageMyAcademy</title>
<?= $this->element('trials_style') ?>
<style>
  .fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; margin:12px 0; }
  .fields input, .fields select, .fields textarea { width:100%; }
  textarea { border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:14px; font-family:inherit; }
  .code { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; background:#f1f5f9; padding:8px 10px; border-radius:8px; word-break:break-all; }
  .row-actions form { display:inline; }
  .small { font-size:12px; color:var(--muted); }
  details summary { cursor:pointer; font-weight:700; color:var(--brand); margin:6px 0; }
</style>
</head>
<body>
<div class="wrap">
  <h1>SMS &amp; WhatsApp</h1>
  <p class="sub">ManageMyAcademy's own accounts, which schools can use without their own provider · the paid add-on per school ·
     <a href="<?= $h($this->Url->build(['controller' => 'Dashboards', 'action' => 'superuserDashboard'])) ?>">← Back to dashboard</a></p>

  <?php if ($notice): ?><div class="msg ok"><?= $h($notice) ?></div><?php endif; ?>
  <?php if ($error): ?><div class="msg err"><?= $h($error) ?></div><?php endif; ?>

  <div class="grid2">
  <?php foreach ($platform as $ch => $p): ?>
    <div class="card">
      <h2><?= $chName[$ch] ?> – ManageMyAcademy's account</h2>
      <?php if ($p['set']): ?>
        <div class="kv"><span>Provider</span><span><?= $h($providers[$p['provider']]['name'] ?? $p['provider']) ?></span></div>
        <div class="kv"><span>Sender</span><span><?= $h($p['sender'] ?: '—') ?></span></div>
        <div class="kv"><span>Default allowance per school</span><span><?= (int)$p['default_allowance'] ?> a month</span></div>
        <div class="kv"><span>Price per message</span><span><?= $p['cost_per_message'] !== null ? $h($p['cost_per_message'] . ' ' . $p['currency']) : '—' ?></span></div>
        <p class="hint">Put this address in the provider's dashboard for delivery reports and replies (STOP):</p>
        <div class="code"><?= $h($p['hook_url']) ?></div>
        <?php if ($p['provider'] === 'meta'): ?><p class="hint">Verify token: <span class="code"><?= $h($p['verify_token']) ?></span></p><?php endif; ?>
        <div class="form-row" style="margin-top:12px">
          <form method="post" action="<?= $h($selfUrl) ?>"><?= $csrf ?><input type="hidden" name="op" value="test"><input type="hidden" name="channel" value="<?= $ch ?>"><button class="btn ghost">Check connection</button></form>
          <a class="btn ghost" href="?edit=<?= $ch ?>">Change</a>
          <form method="post" action="<?= $h($selfUrl) ?>" onsubmit="return confirm('Remove ManageMyAcademy\'s <?= $chName[$ch] ?> account? Schools using it stop sending <?= $chName[$ch] ?>.');"><?= $csrf ?>
            <input type="hidden" name="op" value="remove"><input type="hidden" name="channel" value="<?= $ch ?>"><button class="btn danger">Remove</button></form>
        </div>
      <?php else: ?>
        <p class="hint">Not set up. Schools can only use their own provider account for <?= $chName[$ch] ?>.</p>
      <?php endif; ?>

      <?php if (!$p['set'] || $edit === $ch): ?>
      <form method="post" action="<?= $h($selfUrl) ?>" style="margin-top:14px"><?= $csrf ?>
        <input type="hidden" name="op" value="save"><input type="hidden" name="channel" value="<?= $ch ?>">
        <label>Provider</label>
        <select name="provider" onchange="pm_show('<?= $ch ?>', this.value)">
          <option value="">Choose…</option>
          <?php foreach ($providers as $key => $pv): if (!in_array($ch, $pv['channels'], true)) continue; ?>
            <option value="<?= $h($key) ?>" <?= $p['provider'] === $key ? 'selected' : '' ?>><?= $h($pv['name']) ?></option>
          <?php endforeach; ?>
        </select>
        <?php foreach ($providers as $key => $pv): if (!in_array($ch, $pv['channels'], true)) continue; ?>
          <div class="fields pm-<?= $ch ?>" data-p="<?= $h($key) ?>" style="<?= $p['provider'] === $key ? '' : 'display:none' ?>">
            <?php foreach ($pv['fields'] as [$fk, $label, $secret, $required, $help]): $same = $p['provider'] === $key; ?>
              <div>
                <label><?= $h($label) ?><?= $required ? ' *' : '' ?></label>
                <?php if ($fk === 'headers' || $fk === 'body'): ?>
                  <textarea name="fields[<?= $h($fk) ?>]" rows="3" <?= $same ? '' : 'disabled' ?> placeholder="<?= $secret && $same && !empty($p['fields'][$fk . '__saved']) ? 'Saved – leave empty to keep' : '' ?>"></textarea>
                <?php else: ?>
                  <input type="<?= $secret ? 'password' : 'text' ?>" name="fields[<?= $h($fk) ?>]" autocomplete="off" <?= $same ? '' : 'disabled' ?>
                    value="<?= $secret ? '' : $h($same ? ($p['fields'][$fk] ?? '') : '') ?>" placeholder="<?= $secret && $same && !empty($p['fields'][$fk . '__saved']) ? 'Saved – leave empty to keep' : '' ?>">
                <?php endif; ?>
                <div class="small"><?= $h($help) ?></div>
              </div>
            <?php endforeach; ?>
          </div>
        <?php endforeach; ?>
        <div class="fields">
          <div><label>Sender ID / number</label><input type="text" name="sender" value="<?= $h($p['sender']) ?>" maxlength="40">
            <div class="small"><?= $ch === 'whatsapp' ? 'The WhatsApp number, with country code (not needed for Meta / Whapi).' : 'Registered sender name or number (not needed for MSG91).' ?></div></div>
          <div><label>Default allowance per school (messages a month)</label><input type="number" name="default_allowance" min="0" value="<?= (int)$p['default_allowance'] ?>">
            <div class="small">0 = a school can only send after you give it an allowance.</div></div>
          <div><label>Price per message (optional)</label><input type="text" name="cost_per_message" value="<?= $h($p['cost_per_message'] ?? '') ?>"></div>
          <div><label>Currency</label><input type="text" name="currency" maxlength="3" value="<?= $h($p['currency'] ?: 'USD') ?>"></div>
        </div>
        <button class="btn" type="submit">Save and check</button>
        <?php if ($p['set']): ?><a href="<?= $h($selfUrl) ?>" style="margin-left:10px">Cancel</a><?php endif; ?>
        <p class="hint">Keys are stored encrypted and never shown again.</p>
      </form>
      <?php endif; ?>
    </div>
  <?php endforeach; ?>
  </div>

  <div class="card">
    <h2>Schools</h2>
    <form method="get" action="<?= $h($selfUrl) ?>" class="form-row" style="margin-bottom:12px">
      <input type="text" name="q" value="<?= $h($search) ?>" placeholder="School code or name" style="min-width:240px">
      <button class="btn ghost" type="submit">Search</button>
    </form>
    <div class="scroll">
    <table>
      <tr><th>School</th><th>Add-on</th><th>SMS</th><th>WhatsApp</th><th>This month on your account</th><th></th></tr>
      <?php foreach ($schools as $s): ?>
      <tr>
        <td><b><?= $h($s['code']) ?></b><br><span class="small"><?= $h($s['name']) ?> · <?= $s['billing'] === 'subscription' ? 'International' : 'Indian (legacy)' ?></span></td>
        <td>
          <form method="post" action="<?= $h($selfUrl) ?>"><?= $csrf ?><input type="hidden" name="op" value="addon"><input type="hidden" name="code" value="<?= $h($s['code']) ?>">
            <input type="hidden" name="on" value="<?= $s['addon'] ? '0' : '1' ?>">
            <?= $s['addon'] ? '<span class="badge b-paid">On</span>' : '<span class="badge b-ended">Off</span>' ?>
            <button class="btn ghost" style="padding:4px 10px;font-size:12px"><?= $s['addon'] ? 'Switch off' : 'Switch on' ?></button>
          </form>
        </td>
        <?php foreach (['sms', 'whatsapp'] as $ch): $c = $s['channels'][$ch]; ?>
          <td><?= $modeTxt[$c['mode']] ?? $h($c['mode']) ?><?= $c['mode'] === 'own' && $c['provider'] ? '<br><span class="small">' . $h($providers[$c['provider']]['name'] ?? $c['provider']) . '</span>' : '' ?></td>
        <?php endforeach; ?>
        <td class="small">
          SMS <?= (int)$s['channels']['sms']['used_managed'] ?> / <?= (int)$s['channels']['sms']['effective_allowance'] ?><?= $s['channels']['sms']['cost_managed'] > 0 ? ' · ' . $h($s['channels']['sms']['cost_managed']) : '' ?><br>
          WhatsApp <?= (int)$s['channels']['whatsapp']['used_managed'] ?> / <?= (int)$s['channels']['whatsapp']['effective_allowance'] ?><?= $s['channels']['whatsapp']['cost_managed'] > 0 ? ' · ' . $h($s['channels']['whatsapp']['cost_managed']) : '' ?>
        </td>
        <td><a class="btn ghost" style="padding:4px 10px;font-size:12px" href="<?= $h($this->Url->build(['controller' => 'PlatformMessaging', 'action' => 'school', $s['code']])) ?>">Manage</a></td>
      </tr>
      <?php endforeach; ?>
      <?php if (!$schools): ?><tr><td colspan="6" class="small">No schools found.</td></tr><?php endif; ?>
    </table>
    </div>
  </div>
</div>
<script>
function pm_show(ch, p) {
  document.querySelectorAll('.pm-' + ch).forEach(function (d) {
    var on = d.getAttribute('data-p') === p;
    d.style.display = on ? '' : 'none';
    d.querySelectorAll('input,textarea').forEach(function (i) { i.disabled = !on; });
  });
}
</script>
</body>
</html>
