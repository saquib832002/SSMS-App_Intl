<?php
/** /set-password/{token} – choose a password from the welcome link. */
echo $this->element('sec_style');
?>
<div class="sec-card">
<?php if (!empty($done)): ?>
  <h1>Password saved</h1>
  <p>You can now sign in to the app or the website with your username and new password.</p>
  <?= $this->Html->link('Go to sign in', ['action' => 'login'], ['class' => 'btn']) ?>
<?php elseif (empty($valid)): ?>
  <h1>Link expired</h1>
  <p>This link has expired or was already used. Ask your school to send a new one.</p>
  <?= $this->Html->link('Go to sign in', ['action' => 'login'], ['class' => 'btn ghost']) ?>
<?php else: ?>
  <h1>Choose your password</h1>
  <p>For <strong><?= h($username) ?></strong>. Use at least 8 characters with letters and a number.</p>
  <?= $this->Flash->render() ?>
  <?= $this->Form->create(null) ?>
    <label for="np">New password</label>
    <input type="password" id="np" name="new_password" autocomplete="new-password" minlength="8" required>
    <label for="cp">Type it again</label>
    <input type="password" id="cp" name="confirm_password" autocomplete="new-password" minlength="8" required>
    <button class="btn" type="submit">Save password</button>
  <?= $this->Form->end() ?>
<?php endif; ?>
</div>
