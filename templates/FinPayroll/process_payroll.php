<?php echo $this->element('su_styles'); ?>
<div class="su-page-header">
  <div class="su-page-header-left">
    <h2><i class="bi bi-gear-wide-connected" style="color:#8b5cf6;"></i> Process Payroll</h2>
    <p>FY: <strong><?= h($fy['fy_name']) ?></strong> · <?= count($structures) ?> staff with salary structures</p>
  </div>
  <div class="su-page-header-right">
    <?= $this->Html->link('<i class="bi bi-arrow-left"></i> Back', ['action'=>'index'], ['class'=>'su-btn su-btn-ghost','escape'=>false]) ?>
  </div>
</div>

<?php echo $this->Flash->render(); ?>
<?php
  $att      = $att ?? null;
  $attMonth = $attMonth ?? date('Y-m');
  $wdDefault = $att ? (int)$att['working_days'] : 26;
?>

<?php if (empty($structures)): ?>
<div class="su-card">
  <div class="su-card-body" style="text-align:center;padding:3rem;color:#94a3b8;">
    <i class="bi bi-exclamation-triangle" style="font-size:2.5rem;display:block;margin-bottom:.75rem;color:#f59e0b;"></i>
    No salary structures set up. Please add salary structures for staff before processing payroll.
    <?= $this->Html->link('Add Salary Structure', ['action'=>'addSalaryStructure'], ['class'=>'su-btn su-btn-primary','style'=>'display:inline-block;margin-top:.75rem;']) ?>
  </div>
</div>
<?php return; endif; ?>

<?= $this->Form->create(null, ['url'=>['action'=>'processPayroll'],'id'=>'payrollForm']) ?>

<!-- Run Config -->
<div class="su-card" style="margin-bottom:1rem;">
  <div class="su-card-header"><strong><i class="bi bi-calendar3"></i> Payroll Period</strong></div>
  <div class="su-card-body">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;">
      <div>
        <label class="su-label">Pay Month <span style="color:#ef4444;">*</span></label>
        <?= $this->Form->date('pay_month', ['class'=>'su-input','required'=>true,'value'=>$attMonth.'-01','id'=>'payMonth','onchange'=>'monthChanged()']) ?>
        <p style="font-size:.68rem;color:#94a3b8;margin-top:.25rem;">Select the first day of the pay month</p>
      </div>
      <div>
        <label class="su-label">Run Label</label>
        <?= $this->Form->text('run_label', ['class'=>'su-input','id'=>'runLabel','value'=>date('F Y', strtotime($attMonth.'-01')).' Payroll','placeholder'=>'e.g. July 2026 Payroll']) ?>
      </div>
      <div>
        <label class="su-label">Working Days in Month</label>
        <?= $this->Form->number('working_days', ['class'=>'su-input','min'=>'1','max'=>'31','value'=>(string)$wdDefault,'id'=>'workDays']) ?>
        <p style="font-size:.68rem;color:#94a3b8;margin-top:.25rem;">Used to pro-rate attendance absentees</p>
      </div>
    </div>
    <?php if ($att): ?>
    <div style="margin-top:.85rem;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:.6rem .85rem;font-size:.78rem;color:#1e3a8a;">
      <i class="bi bi-calendar-check"></i>
      Days filled in from <strong>Staff Attendance</strong> for <?= h(date('F Y', strtotime($attMonth.'-01'))) ?>:
      <?= (int)$att['working_days'] ?> working days (weekly offs and holidays left out), minus absences, unpaid leave and ½ for each half day.
      Paid leave and days not marked count as present. You can still change any number.
    </div>
    <?php else: ?>
    <div style="margin-top:.85rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:.6rem .85rem;font-size:.78rem;color:#64748b;">
      <i class="bi bi-info-circle"></i>
      No staff attendance marked for <?= h(date('F Y', strtotime($attMonth.'-01'))) ?> – days are set to the full month. Mark staff attendance in the app to fill these in automatically.
    </div>
    <?php endif; ?>
  </div>
</div>

<!-- Attendance per staff -->
<div class="su-card" style="margin-bottom:1rem;">
  <div class="su-card-header" style="display:flex;justify-content:space-between;align-items:center;">
    <strong><i class="bi bi-calendar-check"></i> Attendance & Estimated Pay</strong>
    <button type="button" onclick="setAllPresent()" class="su-btn su-btn-ghost" style="padding:.3rem .75rem;font-size:.78rem;">Set All Full Month</button>
  </div>
  <div class="su-card-body" style="padding:0;">
    <table class="su-table" style="margin:0;font-size:.8rem;">
      <thead>
        <tr>
          <th>Staff Member</th>
          <th>Designation / Dept</th>
          <th style="text-align:right;">Gross (Full Month)</th>
          <th style="text-align:center;width:130px;">Days Present</th>
          <th style="text-align:right;">Est. Net Pay</th>
        </tr>
      </thead>
      <tbody>
        <?php foreach ($structures as $s):
          $gross = (float)$s['basic'] + (float)$s['hra'] + (float)$s['da'] + (float)$s['other_allowances'];
          $pfEmp = $s['pf_applicable'] ? round((float)$s['basic'] * (float)$s['pf_employee_pct'] / 100, 2) : 0;
          $esiEmp = ($s['esi_applicable'] && $gross <= 21000) ? round($gross * (float)$s['esi_employee_pct'] / 100, 2) : 0;
          $totalDed = $pfEmp + $esiEmp + (float)$s['tds_monthly'] + (float)$s['professional_tax'];
          $net = $gross - $totalDed;
        ?>
        <tr>
          <td><strong><?= h($s['staff_name']) ?></strong></td>
          <td style="color:#64748b;font-size:.75rem;"><?= h($s['designation']??'—') ?> · <?= h($s['department']??'—') ?></td>
          <td style="text-align:right;font-weight:700;color:#1d4ed8;">₹<?= number_format($gross,2) ?></td>
          <td style="text-align:center;">
            <input type="number" name="attendance[<?= $s['staff_id'] ?>]"
                   class="su-input days-present" style="padding:.3rem .5rem;width:80px;text-align:center;"
                   min="0" max="31" step="0.5" value="<?= h((string)($att['payable'][$s['staff_id']] ?? $wdDefault)) ?>"
                   data-gross="<?= $gross ?>" data-ded="<?= $totalDed ?>"
                   onchange="updateNet(this)">
          </td>
          <td style="text-align:right;font-weight:700;color:#065f46;" id="net_<?= $s['staff_id'] ?>">₹<?= number_format($net,2) ?></td>
        </tr>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
</div>

<!-- Notes -->
<div class="su-card" style="margin-bottom:1rem;">
  <div class="su-card-body">
    <label class="su-label">Notes (optional)</label>
    <?= $this->Form->textarea('notes', ['class'=>'su-input','rows'=>2,'placeholder'=>'e.g. Bonus month, increment applied...']) ?>
  </div>
</div>

<div style="background:#f0fdf4;border:2px solid #6ee7b7;border-radius:10px;padding:.85rem 1.2rem;margin-bottom:1rem;display:flex;gap:3rem;align-items:center;flex-wrap:wrap;">
  <div><span style="font-size:.8rem;color:#64748b;">Staff Count:</span> <strong style="color:#1d4ed8;"><?= count($structures) ?></strong></div>
  <div><span style="font-size:.8rem;color:#64748b;">Est. Total Gross:</span> <strong style="color:#1d4ed8;" id="summGross">₹<?= number_format(array_sum(array_map(fn($s)=>(float)$s['basic']+(float)$s['hra']+(float)$s['da']+(float)$s['other_allowances'],$structures)),2) ?></strong></div>
  <div style="flex:1;text-align:right;">
    <?= $this->Html->link('Cancel', ['action'=>'index'], ['class'=>'su-btn su-btn-ghost','style'=>'margin-right:.5rem;']) ?>
    <button type="submit" class="su-btn su-btn-primary" style="background:#8b5cf6;border-color:#8b5cf6;" onclick="return confirm('Generate payroll for <?= count($structures) ?> staff for the selected month?')">
      <i class="bi bi-gear-wide-connected"></i> Process Payroll
    </button>
  </div>
</div>

<?= $this->Form->end() ?>

<script>
function monthChanged() {
  var v = document.getElementById('payMonth').value;   // YYYY-MM-DD
  if (v && v.length >= 7) {
    // reload so days are filled in from staff attendance for that month
    window.location.href = window.location.pathname + '?month=' + v.substring(0, 7);
    return;
  }
  updateLabel();
}
function updateLabel() {
  var d = new Date(document.getElementById('payMonth').value);
  if (isNaN(d)) return;
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('runLabel').value = months[d.getMonth()] + ' ' + d.getFullYear() + ' Payroll';
}
function setAllPresent() {
  var wd = parseFloat(document.getElementById('workDays').value) || 26;
  document.querySelectorAll('.days-present').forEach(function(inp) {
    inp.value = wd;
    updateNet(inp);
  });
}
function updateNet(inp) {
  var wd    = parseFloat(document.getElementById('workDays').value)||26;
  var days  = parseFloat(inp.value)||0;
  var ratio = wd > 0 ? days/wd : 1;
  var gross = parseFloat(inp.dataset.gross)||0;
  var ded   = parseFloat(inp.dataset.ded)||0;
  var net   = (gross * ratio) - (ded * ratio);
  // find the net cell — traverse up to tr, then last td
  var row = inp.closest('tr');
  if (row) {
    var cells = row.querySelectorAll('td');
    cells[cells.length-1].textContent = '₹' + net.toLocaleString('en-IN',{minimumFractionDigits:2});
  }
}
document.querySelectorAll('.days-present').forEach(updateNet);
</script>
