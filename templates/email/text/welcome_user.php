<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to the School Management System</title>
  <style>
    body { margin: 0; padding: 0; background: #f1f5f9; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%); padding: 40px 40px 32px; text-align: center; }
    .header-icon { background: rgba(255,255,255,0.15); width: 64px; height: 64px; border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px; }
    .header h1 { color: #ffffff; font-size: 26px; font-weight: 800; margin: 0 0 6px; }
    .header p  { color: rgba(255,255,255,0.8); font-size: 15px; margin: 0; }
    .body { padding: 40px; }
    .greeting { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
    .intro    { font-size: 15px; color: #475569; line-height: 1.7; margin-bottom: 32px; }
    .cred-box { background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 14px; padding: 24px 28px; margin-bottom: 32px; }
    .cred-box h3 { font-size: 12px; font-weight: 700; color: #94a3b8; letter-spacing: 1.2px; text-transform: uppercase; margin: 0 0 16px; }
    .cred-row { display: flex; align-items: center; margin-bottom: 14px; }
    .cred-row:last-child { margin-bottom: 0; }
    .cred-label { font-size: 13px; color: #64748b; font-weight: 600; width: 120px; flex-shrink: 0; }
    .cred-value { font-size: 15px; color: #0f172a; font-weight: 700; font-family: 'Courier New', monospace; background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 6px 14px; }
    .password-value { color: #2563eb; font-size: 18px; letter-spacing: 2px; }
    .warning-box { background: #fffbeb; border: 1.5px solid #fcd34d; border-radius: 12px; padding: 16px 20px; margin-bottom: 32px; display: flex; gap: 12px; }
    .warning-icon { font-size: 20px; flex-shrink: 0; }
    .warning-text { font-size: 14px; color: #92400e; line-height: 1.6; }
    .warning-text strong { color: #78350f; }
    .btn-wrap { text-align: center; margin-bottom: 32px; }
    .btn { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; font-size: 16px; font-weight: 700; padding: 14px 40px; border-radius: 12px; }
    .steps { margin-bottom: 32px; }
    .steps h3 { font-size: 14px; font-weight: 700; color: #374151; margin-bottom: 16px; }
    .step { display: flex; gap: 14px; margin-bottom: 12px; align-items: flex-start; }
    .step-num { background: #eff6ff; color: #2563eb; font-size: 13px; font-weight: 800; width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .step-text { font-size: 14px; color: #475569; line-height: 1.6; padding-top: 4px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px 40px; text-align: center; }
    .footer p { font-size: 13px; color: #94a3b8; margin: 0 0 4px; }
    .footer a { color: #2563eb; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">

    <!-- Header -->
    <div class="header">
      <div class="header-icon">
        <!-- Simple person SVG inline so no external assets needed -->
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="8" r="4" fill="white"/>
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="white" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
      <h1>Welcome Aboard! 🎉</h1>
      <p>Your School Management System account is ready</p>
    </div>

    <!-- Body -->
    <div class="body">
      <p class="greeting">Hi <?= h($fullName) ?>,</p>
      <p class="intro">
        An administrator has created an account for you on the
        <strong>School Management System</strong>. Below are your login credentials.
        Please log in and change your password immediately.
      </p>

      <!-- Credentials box -->
      <div class="cred-box">
        <h3>Your Login Credentials</h3>
        <div class="cred-row">
          <span class="cred-label">Username</span>
          <span class="cred-value"><?= h($username) ?></span>
        </div>
        <div class="cred-row">
          <span class="cred-label"><?= !empty($setPasswordUrl) ? 'Password' : 'Temp. Password' ?></span>
          <span class="cred-value password-value"><?= !empty($setPasswordUrl) ? 'Choose it with the link below' : h($tempPassword) ?></span>
        </div>
      </div>

      <!-- Warning -->
      <div class="warning-box">
        <span class="warning-icon">⚠️</span>
        <div class="warning-text">
          <strong>This is a temporary password.</strong> For your security, please
          change it immediately after your first login. Do not share it with anyone.
        </div>
      </div>

      <!-- CTA button -->
      <div class="btn-wrap">
        <a href="<?= h(!empty($setPasswordUrl) ? $setPasswordUrl : $loginUrl) ?>" class="btn"><?= !empty($setPasswordUrl) ? 'Set Your Password →' : 'Log In to Your Account →' ?></a>
        <?php if (!empty($setPasswordUrl)): ?><p>Link (works once, for 48 hours): <?= h($setPasswordUrl) ?></p><?php endif; ?>
      </div>

      <!-- Steps -->
      <div class="steps">
        <h3>Getting started — 3 quick steps:</h3>
        <div class="step">
          <span class="step-num">1</span>
          <div class="step-text">Click the button above or visit <a href="<?= h($loginUrl) ?>"><?= h($loginUrl) ?></a></div>
        </div>
        <div class="step">
          <span class="step-num">2</span>
          <div class="step-text">Log in using the credentials above.</div>
        </div>
        <div class="step">
          <span class="step-num">3</span>
          <div class="step-text">Go to <strong>My Profile → Change Password</strong> and set a new secure password.</div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p>This email was sent automatically. Please do not reply.</p>
      <p>Having trouble? Contact your administrator or <a href="mailto:support@school.com">support@school.com</a></p>
    </div>

  </div>
</body>
</html>
