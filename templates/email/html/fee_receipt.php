<?php
/**
 * Fee Receipt — HTML email template
 * File: templates/email/html/fee_receipt.php
 *
 * Inbox-friendly design:
 *  - Table-based layout (not div/flexbox) for Outlook / Gmail compatibility
 *  - Inline styles only (no <style> block — Gmail strips <head> CSS)
 *  - MSO conditional comments for Outlook rendering
 *  - Plain-text friendly fallbacks
 *  - No images, no background-image, no JavaScript
 *  - SPF/DKIM-friendly: no tracking pixels
 */

// Region & formats: numbers, dates and the currency symbol follow the school's settings when the client is known
$__lc = (string)($schoolClientCode ?? '');
$nf = function ($v) use ($__lc) {
    if ($__lc !== '' && class_exists(\App\Service\Locale::class)) {
        try { return \App\Service\Locale::number($__lc, (float)$v); } catch (\Throwable $e) {}
    }
    return number_format((float)$v, 2);
};
// Language: the finished e-mail is translated at the end (texts between tags), see the bottom of this file
ob_start();
$df = function ($d) use ($__lc) {
    if ($__lc !== '' && class_exists(\App\Service\Locale::class)) {
        try { return \App\Service\Locale::date($__lc, $d, 'medium'); } catch (\Throwable $e) {}
    }
    return date('d M Y', strtotime((string)$d));
};

$paidFmt    = $nf((float)($paidAmount    ?? 0));
$balFmt     = $nf((float)($balanceAmount ?? 0));
$feeFmt     = $nf((float)($feeAmount     ?? 0));
$taxFmt     = $nf((float)($totalTax      ?? 0));
$discFmt    = $nf((float)($totalDiscount ?? 0));
$lateFmt    = $nf((float)($totalLateFee  ?? 0));
$hasTax     = (float)($totalTax      ?? 0) > 0;
$hasDisc    = (float)($totalDiscount ?? 0) > 0;
$hasLate    = (float)($totalLateFee  ?? 0) > 0;
$balAmt     = (float)($balanceAmount ?? 0);
$isPaidFull = $balAmt <= 0;
$balColor   = $isPaidFull ? '#15803d' : '#b91c1c';
$currency   = (string)($schoolCurrency ?? '') !== '' ? $schoolCurrency : (($__lc !== '' && class_exists(\App\Service\Locale::class)) ? \App\Service\Locale::get($__lc)['currency_symbol'] : '₹');
$payDateFmt = $df(!empty($paymentDate) ? $paymentDate : ($__lc !== '' && class_exists(\App\Service\Locale::class) ? \App\Service\Locale::today($__lc) : date('Y-m-d')));
$schoolAddr = trim(
    ($schoolAddress ?? '') . ' ' .
    ($schoolCity    ?? '') . ' ' .
    ($schoolState   ?? '') . ' ' .
    ($schoolZip     ?? '')
);
?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"
  "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Fee Receipt #<?= h($receiptNo) ?> — <?= h($schoolName) ?></title>
  <!--[if mso]>
  <noscript>
    <xml><o:OfficeDocumentSettings>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings></xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    /* Client resets */
    body, table, td, p, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; }
    /* Responsive */
    @media only screen and (max-width: 600px) {
      .email-wrap   { width: 100% !important; min-width: 100% !important; }
      .mob-pad      { padding-left: 16px !important; padding-right: 16px !important; }
      .mob-center   { text-align: center !important; }
      .mob-hide     { display: none !important; }
      .hero-amt     { font-size: 32px !important; }
      .col-half     { display: block !important; width: 100% !important; }
      .itbl th, .itbl td { padding: 8px 6px !important; font-size: 11px !important; }
    }
    /* Prevent blue links on iOS */
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">

<!-- Preheader (hidden preview text) -->
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f1f5f9;">
  Fee Receipt #<?= h($receiptNo) ?> — <?= h($studentName) ?> paid <?= $currency ?><?= $paidFmt ?> on <?= h($payDateFmt) ?>
  &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
</div>

<!-- Outer wrapper table -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
       style="background-color:#f1f5f9;">
  <tr>
    <td align="center" style="padding:24px 12px;">

      <!-- Email container -->
      <table role="presentation" class="email-wrap" border="0" cellpadding="0" cellspacing="0"
             width="600" style="max-width:600px;background-color:#ffffff;border-radius:16px;
             overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.10);">

        <!-- ══ HEADER ══════════════════════════════════════════════════════ -->
        <tr>
          <td align="center"
              style="background:linear-gradient(135deg,#1a3c6e 0%,#2563eb 100%);
                     padding:36px 32px 28px;">
            <!-- School icon circle -->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center"
                    style="width:60px;height:60px;background:rgba(255,255,255,0.15);
                           border-radius:50%;font-size:30px;line-height:60px;
                           text-align:center;">
                  🏫
                </td>
              </tr>
            </table>
            <p style="margin:14px 0 4px;font-size:20px;font-weight:800;color:#ffffff;
                      letter-spacing:-0.3px;">
              <?= h($schoolName) ?>
            </p>
            <?php if (!empty(trim($schoolAddr))): ?>
            <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.70);">
              <?= h(trim($schoolAddr)) ?>
            </p>
            <?php endif ?>
            <p style="margin:10px 0 0;font-size:11px;font-weight:700;
                      color:rgba(255,255,255,0.55);text-transform:uppercase;
                      letter-spacing:1.5px;">
              Official Fee Payment Receipt
            </p>
          </td>
        </tr>

        <!-- ══ RECEIPT NUMBER BAND ══════════════════════════════════════════ -->
        <tr>
          <td style="background:#f59e0b;padding:12px 32px;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="font-size:11px;font-weight:700;color:#78350f;
                           text-transform:uppercase;letter-spacing:1px;">
                  Receipt Number
                </td>
                <td align="right" style="font-size:17px;font-weight:900;color:#1c1917;">
                  #<?= h($receiptNo) ?>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ══ BODY ════════════════════════════════════════════════════════ -->
        <tr>
          <td class="mob-pad" style="padding:28px 32px;">

            <!-- Student card -->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                   style="background:#f0f4ff;border-left:4px solid #2563eb;
                          border-radius:10px;margin-bottom:24px;">
              <tr>
                <td style="padding:16px 18px;">
                  <p style="margin:0 0 3px;font-size:16px;font-weight:800;color:#1e3a8a;">
                    <?= h($studentName) ?>
                  </p>
                  <p style="margin:0;font-size:12px;color:#64748b;">
                    Enrollment ID: <strong>#<?= h($enrollmentId) ?></strong>
                  </p>
                </td>
              </tr>
            </table>

            <!-- Paid amount hero -->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                   style="background:<?= $isPaidFull ? '#f0fdf4' : '#fffbeb' ?>;
                          border:2px solid <?= $isPaidFull ? '#86efac' : '#fde68a' ?>;
                          border-radius:14px;margin-bottom:24px;">
              <tr>
                <td align="center" style="padding:24px 20px;">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:700;
                            color:<?= $isPaidFull ? '#15803d' : '#92400e' ?>;
                            text-transform:uppercase;letter-spacing:1.2px;">
                    Amount Paid
                  </p>
                  <p class="hero-amt"
                     style="margin:0;font-size:40px;font-weight:900;
                            color:<?= $isPaidFull ? '#15803d' : '#d97706' ?>;
                            letter-spacing:-1px;">
                    <?= $currency ?> <?= $paidFmt ?>
                  </p>
                  <?php if ($isPaidFull): ?>
                    <p style="margin:10px 0 0;display:inline-block;border:2.5px solid #15803d;
                               color:#15803d;font-size:15px;font-weight:900;
                               padding:3px 16px;border-radius:6px;letter-spacing:3px;">
                      ✓ PAID IN FULL
                    </p>
                  <?php else: ?>
                    <p style="margin:10px 0 0;font-size:13px;color:#b45309;">
                      Outstanding balance: <strong><?= $currency ?> <?= $balFmt ?></strong>
                    </p>
                  <?php endif ?>
                </td>
              </tr>
            </table>

            <!-- Payment details -->
            <p style="margin:0 0 10px;font-size:10px;font-weight:800;color:#94a3b8;
                      text-transform:uppercase;letter-spacing:1.5px;">
              Payment Details
            </p>
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                   style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;
                          margin-bottom:24px;">
              <?php
              $rows = [
                  ['Payment Date',    h($payDateFmt)],
                  ['Payment Method',  h($paymentMethod ?? 'Cash')],
                  ['Total Fee',       $currency . ' ' . $feeFmt],
                  ...($hasDisc ? [['Discount Applied', '−' . $currency . ' ' . $discFmt]] : []),
                  ...($hasTax  ? [['Tax / GST',        '+' . $currency . ' ' . $taxFmt]]  : []),
                  ...($hasLate ? [['Late Fee',         '+' . $currency . ' ' . $lateFmt]] : []),
                  ['Amount Paid',     $currency . ' ' . $paidFmt],
                  ['Balance Due',     $currency . ' ' . $balFmt],
                  ['Recorded By',     h($adminUser ?? '—')],
              ];
              foreach ($rows as $idx => $row):
                $bg = $idx % 2 === 0 ? '#ffffff' : '#f8fafc';
              ?>
              <tr>
                <td style="background:<?= $bg ?>;padding:10px 16px;font-size:13px;
                           font-weight:600;color:#64748b;width:44%;
                           border-bottom:1px solid #f1f5f9;">
                  <?= $row[0] ?>
                </td>
                <td style="background:<?= $bg ?>;padding:10px 16px;font-size:13px;
                           font-weight:700;color:#0f172a;text-align:right;
                           border-bottom:1px solid #f1f5f9;">
                  <?= $row[1] ?>
                </td>
              </tr>
              <?php endforeach ?>
            </table>

            <!-- Fee items breakdown -->
            <?php if (!empty($feeItems)): ?>
            <p style="margin:0 0 10px;font-size:10px;font-weight:800;color:#94a3b8;
                      text-transform:uppercase;letter-spacing:1.5px;">
              Fee Breakdown
            </p>
            <table class="itbl" role="presentation" border="0" cellpadding="0" cellspacing="0"
                   width="100%"
                   style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;
                          margin-bottom:24px;">
              <!-- Table header -->
              <tr style="background:#1e3a8a;">
                <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#ffffff;
                           text-align:left;text-transform:uppercase;letter-spacing:0.8px;">
                  Description
                </th>
                <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#ffffff;
                           text-align:right;text-transform:uppercase;letter-spacing:0.8px;">
                  Fee
                </th>
                <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#ffffff;
                           text-align:right;text-transform:uppercase;letter-spacing:0.8px;"
                    class="mob-hide">
                  Disc
                </th>
                <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#ffffff;
                           text-align:right;text-transform:uppercase;letter-spacing:0.8px;"
                    class="mob-hide">
                  Tax
                </th>
                <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#ffffff;
                           text-align:right;text-transform:uppercase;letter-spacing:0.8px;">
                  Paid
                </th>
                <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#ffffff;
                           text-align:right;text-transform:uppercase;letter-spacing:0.8px;">
                  Balance
                </th>
              </tr>
              <?php foreach ($feeItems as $idx => $fi):
                $fiBal       = (float)($fi['balance_amount']   ?? 0);
                $fiDisc      = (float)($fi['discount_amount']  ?? 0);
                $fiDiscPct   = (float)($fi['discount_percent'] ?? 0);
                $fiTax       = (float)($fi['tax_amount']       ?? 0);
                $fiTaxPct    = (float)($fi['tax_percent']      ?? 0);
                $fiPaid      = (float)($fi['paid_amount']      ?? 0);
                $fiFee       = (float)($fi['fee_amount']       ?? 0);
                $fiBalColor  = $fiBal > 0 ? '#b91c1c' : '#15803d';
                $fiBalLabel  = $fiBal > 0 ? $currency . ' ' . $nf($fiBal) : '✓';
                $monthSuffix = !empty($fi['month_no']) ? ' · ' . h($fi['month_no']) : '';
                $rowBg       = $idx % 2 === 0 ? '#ffffff' : '#f8fafc';
              ?>
              <tr>
                <td style="background:<?= $rowBg ?>;padding:10px 14px;font-size:13px;
                           color:#1e293b;border-bottom:1px solid #f1f5f9;">
                  <?= h($fi['fee_item_name'] ?? '—') ?><?= $monthSuffix ?>
                  <?php if ((float)($fi['late_fee'] ?? 0) > 0): ?>
                    <br/><span style="font-size:10px;color:#b45309;">
                      +Late <?= $currency ?><?= $nf((float)$fi['late_fee']) ?>
                    </span>
                  <?php endif ?>
                </td>
                <td style="background:<?= $rowBg ?>;padding:10px 14px;font-size:13px;
                           font-weight:700;color:#475569;text-align:right;
                           border-bottom:1px solid #f1f5f9;">
                  <?= $currency ?><?= $nf($fiFee) ?>
                </td>
                <td class="mob-hide"
                    style="background:<?= $rowBg ?>;padding:10px 14px;font-size:12px;
                           text-align:right;border-bottom:1px solid #f1f5f9;
                           color:<?= $fiDisc > 0 ? '#15803d' : '#94a3b8' ?>;">
                  <?= $fiDisc > 0
                      ? '-' . $currency . $nf($fiDisc) . '<br/><span style="font-size:10px;">(' . $fiDiscPct . '%)</span>'
                      : '—' ?>
                </td>
                <td class="mob-hide"
                    style="background:<?= $rowBg ?>;padding:10px 14px;font-size:12px;
                           text-align:right;border-bottom:1px solid #f1f5f9;
                           color:<?= $fiTax > 0 ? '#0f4c81' : '#94a3b8' ?>;">
                  <?= $fiTax > 0
                      ? '+' . $currency . $nf($fiTax) . '<br/><span style="font-size:10px;">(' . $fiTaxPct . '%)</span>'
                      : '—' ?>
                </td>
                <td style="background:<?= $rowBg ?>;padding:10px 14px;font-size:13px;
                           font-weight:700;color:#15803d;text-align:right;
                           border-bottom:1px solid #f1f5f9;">
                  <?= $currency ?><?= $nf($fiPaid) ?>
                </td>
                <td style="background:<?= $rowBg ?>;padding:10px 14px;font-size:13px;
                           font-weight:700;text-align:right;
                           color:<?= $fiBalColor ?>;border-bottom:1px solid #f1f5f9;">
                  <?= $fiBalLabel ?>
                </td>
              </tr>
              <?php endforeach ?>
              <tr>
                <td colspan="2" style="background:#f1f5f9;padding:11px 14px;font-size:13px;
                            font-weight:800;color:#0f172a;border-top:2px solid #e2e8f0;">
                  Total
                </td>
                <td class="mob-hide"
                    style="background:#f1f5f9;border-top:2px solid #e2e8f0;"></td>
                <td class="mob-hide"
                    style="background:#f1f5f9;padding:11px 14px;font-size:12px;
                           font-weight:700;color:#0f4c81;text-align:right;
                           border-top:2px solid #e2e8f0;">
                  <?= $hasTax ? '+' . $currency . $taxFmt : '' ?>
                </td>
                <td style="background:#f1f5f9;padding:11px 14px;font-size:13px;
                           font-weight:800;color:#15803d;text-align:right;
                           border-top:2px solid #e2e8f0;">
                  <?= $currency ?><?= $paidFmt ?>
                </td>
                <td style="background:#f1f5f9;padding:11px 14px;font-size:13px;
                           font-weight:800;text-align:right;color:<?= $balColor ?>;
                           border-top:2px solid #e2e8f0;">
                  <?= $currency ?><?= $balFmt ?>
                </td>
              </tr>
            </table>
            <?php endif ?>

            <!-- Balance warning -->
            <?php if (!$isPaidFull): ?>
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
                   style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;
                          margin-bottom:20px;">
              <tr>
                <td style="padding:14px 16px;font-size:13px;color:#92400e;line-height:1.6;">
                  ⚠️ A balance of <strong><?= $currency ?><?= $balFmt ?></strong> is outstanding.
                  Please clear it by the due date to avoid late fee charges.
                </td>
              </tr>
            </table>
            <?php endif ?>

            <!-- Divider -->
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
              <tr><td style="border-top:1px solid #e2e8f0;padding:0;height:1px;"></td></tr>
            </table>
            <p style="margin:18px 0 0;font-size:12px;color:#94a3b8;text-align:center;
                      line-height:1.7;">
              This is a computer-generated receipt and does not require a physical signature.<br/>
              For queries, contact the fee office at
              <a href="mailto:<?= h($fromAddress) ?>"
                 style="color:#2563eb;text-decoration:none;">
                <?= h($fromAddress) ?>
              </a>
            </p>

          </td>
        </tr><!-- /body -->

        <!-- ══ FOOTER ══════════════════════════════════════════════════════ -->
        <tr>
          <td align="center"
              style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;">
            <p style="margin:0 0 5px;font-size:14px;font-weight:800;color:#1e3a8a;">
              <?= h($schoolName) ?>
            </p>
            <?php if (!empty(trim($schoolAddr))): ?>
            <p style="margin:0 0 5px;font-size:11px;color:#94a3b8;">
              <?= h(trim($schoolAddr)) ?>
            </p>
            <?php endif ?>
            <p style="margin:0 0 5px;font-size:12px;color:#94a3b8;line-height:1.6;">
              Thank you for your payment. Please retain this receipt for your records.
            </p>
            <p style="margin:0;font-size:11px;color:#cbd5e1;">
              Generated on <?= h($generatedOn ?? date('d M Y, h:i A')) ?>
            </p>
          </td>
        </tr>

      </table><!-- /email-wrap -->

    </td>
  </tr>
</table><!-- /outer -->

</body>
</html>
<?php
$__html = (string)ob_get_clean();
if ($__lc !== '' && class_exists(\App\Service\Locale::class)) {
    try { $__html = \App\Service\Locale::th($__lc, $__html); } catch (\Throwable $e) {}
}
echo $__html;
