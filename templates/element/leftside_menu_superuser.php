<?php
$session   = $this->getRequest()->getSession();
$firstName = $session->read('ssms_user_firstname') ?: 'Super User';
$userName  = $session->read('ssms_user_name');
$clientCode= $session->read('ssms_client_code');
$userImage = $session->read('ssms_user_image');
?>

<div class="s-sidebar-profile">
  <div class="s-sidebar-avatar">
    <?php if ($clientCode && $userName && $userImage): ?>
      <img src="/clients/<?= h($clientCode) ?>/users/<?= h($userName) ?>/<?= h($userImage) ?>" alt="">
    <?php else: ?>
      <?= strtoupper(substr($firstName, 0, 1)) ?>
    <?php endif; ?>
  </div>
  <div>
    <div class="s-sidebar-name"><?= h($firstName) ?></div>
    <span class="s-sidebar-role">Super User</span>
  </div>
</div>

<nav style="flex:1;overflow-y:auto;">

  <div class="s-nav-section">
    <div class="s-nav-label">Overview</div>
    <div class="s-nav-item">
      <a href="<?= $this->Url->build(['controller'=>'Dashboards','action'=>'superuserDashboard']) ?>" class="s-nav-link">
        <span class="s-nav-icon"><i class="bi bi-speedometer2"></i></span> Dashboard
      </a>
    </div>
  </div>

  <div class="s-nav-section">
    <div class="s-nav-label">Support</div>
    <div class="s-nav-item">
      <a href="/admin/support-tickets" class="s-nav-link">
        <span class="s-nav-icon"><i class="bi bi-headset"></i></span> Support Tickets
      </a>
    </div>
  </div>

  <div class="s-nav-section">
    <div class="s-nav-label">Messaging</div>
    <div class="s-nav-item">
      <a href="/admin/messaging" class="s-nav-link">
        <span class="s-nav-icon"><i class="bi bi-chat-dots"></i></span> SMS &amp; WhatsApp
      </a>
    </div>
  </div>

  <div class="s-nav-section">
    <div class="s-nav-label">Client Management</div>
    <div class="s-nav-item">
      <button class="s-nav-link" data-toggle="subnav" data-target="sub-su-clients" aria-expanded="false">
        <span class="s-nav-icon"><i class="bi bi-building"></i></span>
        Clients <i class="bi bi-chevron-right s-nav-chevron"></i>
      </button>
      <div class="s-subnav" id="sub-su-clients">
        <a href="<?= $this->Url->build(['controller'=>'SsmsClients','action'=>'add']) ?>" class="s-subnav-link">Add Client</a>
        <a href="<?= $this->Url->build(['controller'=>'SsmsClients','action'=>'index']) ?>" class="s-subnav-link">View / Edit Clients</a>
        <a href="/admin/clients/trials" class="s-subnav-link">Trial Clients</a>
        <a href="<?= $this->Url->build(['controller'=>'SaweraSsmsUsers','action'=>'addClientUser']) ?>" class="s-subnav-link">Add Client User</a>
      </div>
    </div>
  </div>

</nav>

<div class="s-sidebar-footer">
  <a href="<?= $this->Url->build(['controller'=>'SaweraSsmsUsers','action'=>'profile',$userName]) ?>" title="Profile"><i class="bi bi-person-circle"></i></a>
  <a href="<?= $this->Url->build(['controller'=>'SaweraSsmsUsers','action'=>'logout']) ?>" title="Sign Out" style="margin-left:auto;"><i class="bi bi-box-arrow-right"></i></a>
</div>
