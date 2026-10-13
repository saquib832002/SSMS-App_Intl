<?php
// Language: translated at the end (texts between tags) – see the bottom of this file
$__lc = (string)($schoolClientCode ?? '');
ob_start();
?><div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#374151;">

    <h2 style="color:#0f4c81;margin-bottom:4px;"><?= h($instituteName) ?></h2>
    <h3 style="color:#1e293b;font-weight:600;margin-bottom:20px;">Student Portal Account Created</h3>

    <p>Dear <strong><?= h($firstName) ?></strong>,</p>
    <p style="margin:12px 0;">
        Your <strong><?= h($role) ?></strong> portal account has been created successfully.
        Use the details below to log in.
    </p>

    <table style="border-collapse:collapse;width:100%;margin:20px 0;border:1px solid #e2e8f0;">
        <tr>
            <td style="padding:12px 16px;background:#f1f5f9;font-weight:600;width:40%;">Username</td>
            <td style="padding:12px 16px;background:#fff;font-family:monospace;"><?= h($enrollmentId) ?></td>
        </tr>
        <tr>
            <td style="padding:12px 16px;background:#f1f5f9;font-weight:600;">Password</td>
            <td style="padding:12px 16px;background:#fff;font-family:monospace;font-size:1.1em;letter-spacing:2px;color:#0f4c81;">
                <?= h($password) ?>
            </td>
        </tr>
    </table>

    <p style="margin:20px 0;">
        <a href="<?= h($loginUrl) ?>"
           style="display:inline-block;background:#0f4c81;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">
            Login to Portal &rarr;
        </a>
    </p>

    <p style="color:#64748b;font-size:.85em;margin-top:24px;line-height:1.6;">
        Your username is your <strong>Enrollment Number</strong>.<br>
        Please keep your credentials safe and do not share them with anyone.<br>
        If you did not request this account, contact the school office immediately.
    </p>

</div>
<?php
$__html = (string)ob_get_clean();
if ($__lc !== '' && class_exists(\App\Service\Locale::class)) {
    try { $__html = \App\Service\Locale::th($__lc, $__html); } catch (\Throwable $e) {}
}
echo $__html;
