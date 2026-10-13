<?php
/**
 * Welcome User email template
 * File: templates/email/html/welcome_user.php
 */
?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"
  "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Welcome to School Management System</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings>
    <o:PixelsPerInch>96</o:PixelsPerInch>
  </o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style type="text/css">
    body,table,td,p,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
    a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;}
    @media only screen and (max-width:600px){
      .email-wrap{width:100%!important;min-width:100%!important;}
      .mob-pad{padding-left:20px!important;padding-right:20px!important;}
      .cta-btn{padding:14px 24px!important;font-size:14px!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;
             font-family:'Segoe UI',Arial,Helvetica,sans-serif;">

<!-- Preheader -->
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f1f5f9;">
  Hi <?= h($fullName) ?>, your School Management System account is ready. Log in now.
  &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
</div>

<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
       style="background-color:#f1f5f9;">
  <tr>
    <td align="center" style="padding:32px 12px;">

      <table role="presentation" class="email-wrap" border="0" cellpadding="0" cellspacing="0"
             width="600" style="max-width:600px;background:#ffffff;border-radius:16px;
             overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.10);">

        <!-- HEADER -->
        <tr>
          <td align="center"
              style="background:linear-gradient(135deg,#1d4ed8 0%,#2563eb 100%);
                     padding:36px 32px 28px;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center"
                    style="width:60px;height:60px;background:rgba(255,255,255,0.15);
                           border-radius:16px;text-align:center;line-height:60px;
                           font-size:28px;">
                  👤
                </td>
              </tr>
            </table>
            <p style="margin:14px 0 4px;font-size:22px;font-weight:800;color:#ffffff;">
              Welcome Aboard! 🎉
            </p>
            <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.75);">
              Your School Management System account is ready
            </p>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td class="mob-pad" style="padding:32px 36px;">

            <!-- Greeting -->
            <p style="margin:0 0 10px;font-size:17px;font-weight:700;color:#0f172a;">
              Hi <?= h($fullName) ?>,
            </p>
            <p style="margin:0 0 28px;font-size:14px;color:#475569;line-height:1.7;">
              An administrator has created an account for you on the
              <strong style="color:#0f172a;">School Management System</strong>.
              Your login credentials are below. Please log in and change your
              temporary password immediately.
            </p>

            <!-- Credentials box -->
            <p style="margin:0 0 10px;font-size:10px;font-weight:800;color:#94a3b8;
                      text-transform:uppercase;letter-spacing:1.5px;">
              Your Login Credentials
            </p>
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                   style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:12px;
                          margin-bottom:24px;">
              <tr>
                <td style="padding:14px 18px;font-size:13px;font-weight:600;
                           color:#64748b;width:44%;border-bottom:1px solid #e2e8f0;">
                  Username
                </td>
                <td style="padding:14px 18px;font-size:14px;font-weight:700;
                           color:#0f172a;font-family:'Courier New',monospace;
                           border-bottom:1px solid #e2e8f0;text-align:right;">
                  <?= h($username) ?>
                </td>
              </tr>
              <tr>
                <td style="padding:14px 18px;font-size:13px;font-weight:600;color:#64748b;">
                  <?= !empty($setPasswordUrl) ? 'Password' : 'Temp. Password' ?>
                </td>
                <td style="padding:14px 18px;text-align:right;">
                  <span style="font-size:20px;font-weight:900;color:#2563eb;
                               letter-spacing:4px;font-family:'Courier New',monospace;">
                    <?= !empty($setPasswordUrl) ? '<span style="font-size:13px;letter-spacing:0;font-family:Arial,sans-serif;">Choose it with the button below</span>' : h($tempPassword) ?>
                  </span>
                </td>
              </tr>
            </table>

            <!-- Warning -->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                   style="background:#fffbeb;border:1.5px solid #fcd34d;border-radius:10px;
                          margin-bottom:24px;">
              <tr>
                <td style="padding:14px 16px;">
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:18px;padding-right:12px;vertical-align:top;">⚠️</td>
                      <td style="font-size:13px;color:#92400e;line-height:1.6;">
                        <?php if (!empty($setPasswordUrl)): ?>
                        <strong style="color:#78350f;">The link works once, for 48 hours.</strong>
                        If it has expired, ask your school to send a new one. Never share your
                        password with anyone, including administrators.
                        <?php else: ?>
                        <strong style="color:#78350f;">This is a temporary password.</strong>
                        Change it immediately after first login. Never share your
                        password with anyone, including administrators.
                        <?php endif; ?>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- CTA button -->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                   style="margin-bottom:28px;">
              <tr>
                <td align="center">
                  <a href="<?= h(!empty($setPasswordUrl) ? $setPasswordUrl : $loginUrl) ?>" class="cta-btn"
                     style="display:inline-block;background:#2563eb;color:#ffffff;
                            text-decoration:none;font-size:15px;font-weight:700;
                            padding:14px 40px;border-radius:12px;">
                    <?= !empty($setPasswordUrl) ? 'Set Your Password →' : 'Log In to Your Account →' ?>
                  </a>
                </td>
              </tr>
            </table>

            <!-- Steps -->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                   style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;
                          margin-bottom:24px;">
              <tr>
                <td style="padding:20px 20px 8px;">
                  <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#374151;">
                    Getting started — 3 quick steps:
                  </p>
                </td>
              </tr>
              <?php foreach (!empty($setPasswordUrl) ? [
                ['1', 'Click the button above and choose your own password.'],
                ['2', 'Open the app (or visit <a href="' . h($loginUrl) . '" style="color:#2563eb;text-decoration:none;">' . h($loginUrl) . '</a>).'],
                ['3', 'Sign in with the username above and your new password.'],
              ] : [
                ['1', 'Click the button above or visit <a href="' . h($loginUrl) . '" style="color:#2563eb;text-decoration:none;">' . h($loginUrl) . '</a>.'],
                ['2', 'Log in using the username and temporary password above.'],
                ['3', 'Go to <strong>My Profile → Change Password</strong> and set a new secure password.'],
              ] as $step): ?>
              <tr>
                <td style="padding:0 20px 14px;">
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="width:30px;height:30px;background:#eff6ff;color:#2563eb;
                                 font-size:13px;font-weight:800;text-align:center;
                                 border-radius:8px;vertical-align:middle;">
                        <?= $step[0] ?>
                      </td>
                      <td style="padding-left:12px;font-size:13px;color:#475569;line-height:1.6;">
                        <?= $step[1] ?>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <?php endforeach ?>
            </table>

            <!-- Divider -->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
              <tr><td style="border-top:1px solid #e2e8f0;height:1px;padding:0;"></td></tr>
            </table>
            <p style="margin:18px 0 0;font-size:12px;color:#94a3b8;text-align:center;
                      line-height:1.7;">
              This is an automated email. Please do not reply to this message.
            </p>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td align="center"
              style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;">
            <p style="margin:0 0 4px;font-size:14px;font-weight:800;color:#1e3a8a;">
              School Management System
            </p>
            <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
              Having trouble? Contact your administrator or
              <a href="mailto:support@sawera.info"
                 style="color:#2563eb;text-decoration:none;">support@sawera.info</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>