<?php
/** Web sign-in: required two-step set-up. */
echo $this->element('sec_style');
?>
<div class="sec-card">
<?php if (!empty($backupCodes)): ?>
  <h1>Two-step login is on</h1>
  <p>Save these backup codes somewhere safe. Each one works once if you lose your phone. They won't be shown again.</p>
  <div class="codes"><?php foreach ($backupCodes as $c): ?><span><?= h($c) ?></span><?php endforeach; ?></div>
  <?= $this->Form->create(null, ['url' => ['action' => 'loginSetup']]) ?>
    <button class="btn" type="submit">I've saved them – continue</button>
  <?= $this->Form->end() ?>
<?php else: ?>
  <h1>Set up two-step login</h1>
  <p>Your school requires two-step login for your role. In Google Authenticator or Microsoft Authenticator, choose <strong>Add account → Enter a setup key</strong> and type this key (time-based):</p>
  <?= $this->Flash->render() ?>
  <div class="key"><?= h($setup['secret'] ?? '') ?></div>
  <p class="muted">Account name: ManageMyAcademy. On a phone you can also <a href="<?= h($setup['uri'] ?? '#') ?>">open this link</a> to add it.</p>
  <?= $this->Form->create(null, ['url' => ['action' => 'loginSetup']]) ?>
    <label for="code">Enter the 6-digit code it shows</label>
    <input type="text" id="code" name="code" class="code" inputmode="numeric" maxlength="7" autocomplete="one-time-code" required autofocus>
    <button class="btn" type="submit">Turn on two-step login</button>
  <?= $this->Form->end() ?>
<?php endif; ?>
</div>
