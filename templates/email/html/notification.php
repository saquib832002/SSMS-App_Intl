<?php
/**
 * Automatic notification e-mail (Notify): absence, notice, fee reminder, report card …
 * $title and $body are already in the reader's language (the school's own text, e.g. a notice, stays as typed).
 */
use App\Service\Locale;

$__lc  = (string)($schoolClientCode ?? '');
$__t   = fn(string $s, array $v = []) => $__lc !== '' ? Locale::t($__lc, $s, $v) : strtr($s, array_combine(array_map(fn($k) => '{' . $k . '}', array_keys($v)), array_values($v)) ?: []);
$__rtl = $__lc !== '' && Locale::isRtl($__lc);
?><div dir="<?= $__rtl ? 'rtl' : 'ltr' ?>" style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#374151;text-align:<?= $__rtl ? 'right' : 'left' ?>;">
    <h2 style="color:#0f4c81;margin:0 0 4px;"><?= h((string)($schoolName ?? '')) ?></h2>
    <h3 style="color:#1e293b;font-weight:600;margin:0 0 18px;"><?= h((string)($title ?? '')) ?></h3>
    <div style="font-size:15px;line-height:1.6;margin:0 0 22px;"><?= nl2br(h((string)($body ?? ''))) ?></div>
    <p style="color:#64748b;font-size:.85em;margin-top:24px;line-height:1.6;border-top:1px solid #e2e8f0;padding-top:12px;">
        <?= h($__t('You can see all school messages in the app, and choose which ones you get by e-mail under Menu › My notifications.')) ?><br>
        <?= h($__t('This is an automatic message from {school}. Please do not reply to it.', ['school' => (string)($schoolName ?? '')])) ?>
    </p>
</div>
