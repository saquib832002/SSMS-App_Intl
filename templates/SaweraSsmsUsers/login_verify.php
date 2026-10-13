<?php
/** Web sign-in, step 2 (two-step login). */
echo $this->element('sec_style');
?>
<div class="sec-card">
  <h1>Two-step sign-in</h1>
  <p>Open your authenticator app and enter the 6-digit code for <strong>ManageMyAcademy · <?= h($pending['user']) ?></strong>.</p>
  <?= $this->Flash->render() ?>
  <?= $this->Form->create(null, ['url' => ['action' => 'loginVerify']]) ?>
    <div class="tabs" role="radiogroup" aria-label="Code type">
      <label><input type="radio" name="method" value="totp" checked><span>Authenticator</span></label>
      <label><input type="radio" name="method" value="email"><span>E-mail code</span></label>
      <label><input type="radio" name="method" value="backup"><span>Backup code</span></label>
    </div>
    <label for="code">Code</label>
    <input type="text" id="code" name="code" class="code" autocomplete="one-time-code" inputmode="text" maxlength="12" required autofocus>
    <div class="row"><input type="checkbox" id="trust" name="trust_device" value="1"><label for="trust" style="margin:0;font-weight:500">Trust this browser for 30 days</label></div>
    <button class="btn" type="submit">Verify</button>
  <?= $this->Form->end() ?>
  <?= $this->Form->create(null, ['url' => ['action' => 'loginVerify']]) ?>
    <input type="hidden" name="send_email" value="1">
    <button class="btn ghost" type="submit">E-mail me a code<?= !empty($pending['email']) ? ' (' . h($pending['email']) . ')' : '' ?></button>
  <?= $this->Form->end() ?>
  <p class="muted">Lost your phone? Use a backup code, or ask the school owner to reset your two-step login. <?= $this->Html->link('Start again', ['action' => 'logout']) ?></p>
</div>
