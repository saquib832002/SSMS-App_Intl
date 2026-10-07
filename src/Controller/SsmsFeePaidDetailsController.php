<?php
declare(strict_types=1);

namespace App\Controller;

use App\Controller\Traits\FinAutoPostTrait;
use Cake\Datasource\ConnectionManager;
use Cake\Event\EventInterface;
use Cake\I18n\DateTime;
use Cake\Log\Log;
use Cake\Mailer\Mailer;

/**
 * SsmsFeePaidDetails Controller
 *
 * Enhanced with full fee-collection feature-set ported from FeeApiController:
 *   feeCollection, collectFee, receipt, invoice, paymentDueList,
 *   paymentDueByClass, feeCollectionReport, approveCollection,
 *   feeItems, classFeeStructure, feeDemandSlip, studentDiscounts,
 *   updateStudentFee, deenrollFee, reEnroll, sendEmail, export
 *
 * @property \App\Model\Table\SsmsFeePaidDetailsTable $SsmsFeePaidDetails
 */
class SsmsFeePaidDetailsController extends AppController
{
    use FinAutoPostTrait;
    public function beforeFilter(EventInterface $event): void
    {
        parent::beforeFilter($event);
        // paymentCallback: PhonePe server-to-server webhook (no browser session)
        // paymentReturn: browser redirect back after payment (may not have session context yet)
        $this->Authentication->allowUnauthenticated([
            'login', 'logout',
            'paymentCallback',
            'paymentReturn',
        ]);
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /** PHP-session client code (replaces API header ssmsClientCode) */
    private function _clientCode(): string
    {
        return (string)$this->request->getSession()->read('ssms_client_code');
    }

    private function _userName(): string
    {
        return (string)$this->request->getSession()->read('ssms_user_name');
    }

    private function _userRole(): string
    {
        return strtolower((string)$this->request->getSession()->read('ssms_user_role'));
    }

    /** Fetch school / client info from ssms_clients */
    private function _clientInfo(): array
    {
        $cc  = $this->_clientCode();
        $db  = ConnectionManager::get('default');
        $empty = [
            'header_text'          => 'School Management System',
            'address' => '', 'city' => '', 'state' => '',
            'zip' => '', 'email' => '', 'phone' => '', 'logo_name' => '',
            'upi_id'               => '',
            'pay_account_name'     => '',
            'phonepe_merchant_id'  => '',
            'phonepe_salt_key'     => '',
            'phonepe_salt_index'   => 1,
            'phonepe_env'          => 'sandbox',
            'razorpay_key_id'      => '',
            'razorpay_key_secret'  => '',
            'razorpay_env'         => 'test',
            'currency'             => '₹',
        ];
        if (empty($cc)) return $empty;
        try {
            $row = $db->execute(
                "SELECT ssms_client_header_text, logo_name, ssms_client_address,
                        ssms_client_city, ssms_client_state, ssms_client_zip,
                        ssms_client_email, ssms_client_phone,
                        upi_id, pay_account_name,
                        phonepe_merchant_id, phonepe_salt_key,
                        phonepe_salt_index, phonepe_env,
                        razorpay_key_id, razorpay_key_secret, razorpay_env,
                        currency
                 FROM   ssms_clients
                 WHERE  ssms_client_code = :code LIMIT 1",
                ['code' => $cc]
            )->fetchAssoc();
            if (empty($row)) return $empty;
            return [
                'header_text'      => trim((string)($row['ssms_client_header_text'] ?? '')) ?: $empty['header_text'],
                'address'          => trim((string)($row['ssms_client_address']     ?? '')),
                'city'             => trim((string)($row['ssms_client_city']        ?? '')),
                'state'            => trim((string)($row['ssms_client_state']       ?? '')),
                'zip'              => trim((string)($row['ssms_client_zip']         ?? '')),
                'email'            => trim((string)($row['ssms_client_email']       ?? '')),
                'phone'            => trim((string)($row['ssms_client_phone']       ?? '')),
                'logo_name'        => trim((string)($row['logo_name']               ?? '')),
                'upi_id'              => trim((string)($row['upi_id']               ?? '')),
                'pay_account_name'    => trim((string)($row['pay_account_name']     ?? '')),
                'phonepe_merchant_id' => trim((string)($row['phonepe_merchant_id']  ?? '')),
                'phonepe_salt_key'    => trim((string)($row['phonepe_salt_key']     ?? '')),
                'phonepe_salt_index'  => (int)($row['phonepe_salt_index']           ?? 1),
                'phonepe_env'         => trim((string)($row['phonepe_env']          ?? 'sandbox')),
                'razorpay_key_id'     => trim((string)($row['razorpay_key_id']      ?? '')),
                'razorpay_key_secret' => trim((string)($row['razorpay_key_secret']  ?? '')),
                'razorpay_env'        => trim((string)($row['razorpay_env']         ?? 'test')),
                'currency'            => trim((string)($row['currency']             ?? '')) ?: '₹',
            ];
        } catch (\Exception $e) {
            Log::warning('_clientInfo failed: ' . $e->getMessage());
            return $empty;
        }
    }

    /** Map feeFor code to DB category + enrollment table */
    private function _feeForMap(string $feeFor): array
    {
        return match (strtoupper($feeFor)) {
            'HTL'   => ['text' => 'Hostel',    'category' => 'Hostel',    'enrTable' => 'ssms_hostel_enrollment'],
            'TRP'   => ['text' => 'Transport', 'category' => 'Transport', 'enrTable' => 'ssms_transport_enrollments'],
            default => ['text' => 'School',    'category' => 'Academic',  'enrTable' => 'ssms_student_enrollment'],
        };
    }

    // =========================================================================
    // INDEX — paginated transaction list
    // =========================================================================

    public function index()
    {
        $query = $this->SsmsFeePaidDetails->find();

        // Optional filters from GET
        $filters = $this->request->getQueryParams();
        foreach (['enrollment_id', 'branch_id', 'class_id', 'session_id', 'admin_review'] as $f) {
            if (!empty($filters[$f])) {
                $query->where(["SsmsFeePaidDetails.{$f}" => $filters[$f]]);
            }
        }
        if (!empty($filters['date_from'])) {
            $query->where(['SsmsFeePaidDetails.payment_date >=' => $filters['date_from']]);
        }
        if (!empty($filters['date_to'])) {
            $query->where(['SsmsFeePaidDetails.payment_date <=' => $filters['date_to']]);
        }

        $query->orderDesc('SsmsFeePaidDetails.trxn_id');
        $ssmsFeePaidDetails = $this->paginate($query);

        $this->set(compact('ssmsFeePaidDetails'));
    }

    // =========================================================================
    // VIEW — single transaction
    // =========================================================================

    public function view($id = null)
    {
        $db  = ConnectionManager::get('default');
        $row = $db->execute("
            SELECT fp.*,
                   COALESCE(fi.fee_item_name, CONCAT('Fee #', fp.fee_item_id)) AS fee_item_name,
                   fi.fee_code, fi.fee_type,
                   sc.class_name,
                   COALESCE(ss.session_name, '') AS session_name,
                   COALESCE(sb.branch_name, '') AS branch_name
            FROM   ssms_fee_paid_details fp
            LEFT JOIN ssms_fee_items fi   ON fi.fee_item_id = fp.fee_item_id
            LEFT JOIN ssms_classes   sc   ON sc.class_id    = fp.class_id
            LEFT JOIN ssms_sessions  ss   ON ss.session_id  = fp.session_id
            LEFT JOIN ssms_branch    sb   ON sb.branch_id   = fp.branch_id
            WHERE  fp.trxn_id = :id LIMIT 1
        ", ['id' => (int)$id])->fetchAssoc();

        if (empty($row)) {
            $this->Flash->error('Transaction not found.');
            return $this->redirect(['action' => 'index']);
        }

        $ssmsFeePaidDetails = $row;
        $this->set(compact('ssmsFeePaidDetails'));
    }

    // =========================================================================
    // FEE COLLECTION — main collection page for a student
    // Route: /ssms-fee-paid-details/student-class-fee/:enrollId/:classId/:branchId/:feeFor
    //        /ssms-fee-paid-details/fee-collection/:enrollId/:classId/:branchId/:feeFor  (alias)
    // =========================================================================

    /** Alias kept for backward-compat with existing links */
    public function feeCollection($enrollmentId = null, $classId = null, $branchId = null, $feeFor = 'SCH')
    {
        $this->viewBuilder()->setTemplate('student_class_fee');
        return $this->studentClassFee($enrollmentId, $classId, $branchId, $feeFor);
    }

    public function studentClassFee($enrollmentId = null, $classId = null, $branchId = null, $feeFor = 'SCH')
    {
        $clientCode = $this->_clientCode();
        $db         = ConnectionManager::get('default');
        $today      = date('Y-m-d');
        // Always show ALL categories on this page
        $feeFor     = 'ALL';
        $feeForText = 'All Fees';

        // ── Student info — always from school enrollment table ──────────────
        $student = $db->execute("
            SELECT e.enrollment_id, e.registration_id, e.class_id, e.session_id, e.branch_id,
                   r.student_first_name, r.student_last_name, r.mobile_number, r.email_address,
                   sc.class_name,
                   COALESCE(ss.session_name, '') AS session_name,
                   COALESCE(sb.branch_name, '')  AS branch_name
            FROM   ssms_student_enrollment e
            INNER JOIN ssms_student_registration r  ON r.registration_id = e.registration_id
            LEFT  JOIN ssms_classes sc ON sc.class_id   = e.class_id
            LEFT  JOIN ssms_sessions ss ON ss.session_id = e.session_id
            LEFT  JOIN ssms_branch   sb ON sb.branch_id  = e.branch_id
            WHERE  e.enrollment_id    = :eid
              AND  e.ssms_client_code = :cc
            LIMIT 1
        ", ['eid' => $enrollmentId, 'cc' => $clientCode])->fetchAssoc();

        if (empty($student)) {
            $this->Flash->error('Student enrollment not found.');
            return $this->redirect(['action' => 'index']);
        }

        $registrationId = $student['registration_id'];
        $enrollID       = $enrollmentId;
        $className      = $student['class_name'];
        $sessionName    = $student['session_name'];
        $studentName    = trim($student['student_first_name'] . ' ' . $student['student_last_name']);

        // ── Due fees — run for all 3 categories and merge ──────────────────────
        // enrExtra: extra INNER JOIN conditions per category to prevent duplicate rows
        // (HTL needs current_status='active' because de-enroll/re-enroll creates multiple rows)
        $allCatMaps = [
            'SCH' => ['label' => 'School',    'category' => 'Academic',  'enrTable' => 'ssms_student_enrollment',    'enrExtra' => ''],
            'HTL' => ['label' => 'Hostel',    'category' => 'Hostel',    'enrTable' => 'ssms_hostel_enrollment',      'enrExtra' => "AND enr.current_status = 'active'"],
            'TRP' => ['label' => 'Transport', 'category' => 'Transport', 'enrTable' => 'ssms_transport_enrollments', 'enrExtra' => ''],
        ];

        $dueQueryTpl = "
            SELECT
                fs.fee_id,
                fs.fee_item_id,
                fs.month_no,
                fs.due_date,
                fs.class_id,
                fs.session_id,
                fs.branch_id,
                fs.ssms_client_code,
                COALESCE(sc.class_name, CONCAT('Class #', fs.class_id)) AS class_name,
                COALESCE(fi.fee_item_name, CONCAT('Fee #', fs.fee_item_id)) AS fee_item_name,
                fs.fee_amount,
                COALESCE(paid_agg.total_fee_paid, 0)                        AS total_fee_paid,
                COALESCE(sd.discount_percent, 0)                            AS discount_percent,
                COALESCE(sd.discount_amount,  0)                            AS discount_amount,
                COALESCE(sd.reason, '')                                     AS discount_reason,
                COALESCE(fi.tax_percent, 0)                                 AS tax_percent,
                ROUND((fs.fee_amount - COALESCE(sd.discount_amount, 0)) * COALESCE(fi.tax_percent, 0) / 100, 2) AS tax_amount,
                ROUND(
                    (fs.fee_amount - COALESCE(sd.discount_amount, 0))
                    + ROUND((fs.fee_amount - COALESCE(sd.discount_amount, 0)) * COALESCE(fi.tax_percent, 0) / 100, 2),
                2)                                                           AS net_fee_amount,
                ROUND(
                    (fs.fee_amount - COALESCE(sd.discount_amount, 0)
                     + ROUND((fs.fee_amount - COALESCE(sd.discount_amount, 0)) * COALESCE(fi.tax_percent, 0) / 100, 2))
                    - COALESCE(paid_agg.total_fee_paid, 0),
                2)                                                           AS balance_due,
                paid_agg.latest_trxn_id                                      AS latest_trxn_id,
                paid_agg.latest_receipt                                       AS receipt_number
            FROM ssms_fee_structure fs

            LEFT JOIN ssms_classes sc ON sc.class_id = fs.class_id

            LEFT JOIN ssms_fee_items fi
                ON  fi.fee_item_id = fs.fee_item_id
                AND fi.category    = :category
                AND fs.due_date    < :today

            LEFT JOIN (
                SELECT fp.fee_id, fp.fee_item_id,
                       SUM(fp.paid_amount - COALESCE(fp.late_fee, 0)) AS total_fee_paid,
                       MAX(fp.trxn_id)                                 AS latest_trxn_id,
                       MAX(fp.receipt_number)                          AS latest_receipt
                FROM   ssms_fee_paid_details fp
                WHERE  fp.enrollment_id = :eid_agg
                  AND  fp.paid_amount   > 0
                GROUP BY fp.fee_id, fp.fee_item_id
            ) paid_agg ON paid_agg.fee_id = fs.fee_id AND paid_agg.fee_item_id = fs.fee_item_id

            LEFT JOIN ssms_student_discounts sd
                ON  sd.enrollment_id    = :eid_disc
                AND sd.fee_item_id      = fs.fee_item_id
                AND sd.session_id       = fs.session_id
                AND sd.ssms_client_code = fs.ssms_client_code

            INNER JOIN __ENR_TABLE__ enr
                ON  enr.class_id      = fs.class_id
                AND enr.session_id    = fs.session_id
                AND fi.category       = :category2
                AND enr.enrollment_id = :eid_enr
                __ENR_EXTRA__

            WHERE fs.ssms_client_code = :cc
              AND fs.fee_id = (
                  SELECT MIN(fs2.fee_id)
                  FROM   ssms_fee_structure fs2
                  WHERE  fs2.fee_item_id      = fs.fee_item_id
                    AND  fs2.month_no         = fs.month_no
                    AND  fs2.class_id         = fs.class_id
                    AND  fs2.session_id       = fs.session_id
                    AND  fs2.ssms_client_code = fs.ssms_client_code
              )
        ";

        $ssmsFeeDueDetails = [];
        foreach ($allCatMaps as $catCode => $catMap) {
            $dueQuery  = str_replace(
                ['__ENR_TABLE__', '__ENR_EXTRA__'],
                [$catMap['enrTable'], $catMap['enrExtra']],
                $dueQueryTpl
            );
            $dueParams = [
                'category'  => $catMap['category'],
                'category2' => $catMap['category'],
                'today'     => $today,
                'eid_agg'   => $enrollmentId,
                'eid_disc'  => $enrollmentId,
                'eid_enr'   => $enrollmentId,
                'cc'        => $clientCode,
            ];
            if ($catCode === 'SCH') {
                // School: filter by URL params if provided
                if (!empty($classId)) {
                    $dueQuery .= " AND fs.class_id = :class_id";
                    $dueParams['class_id'] = (int)$classId;
                }
                if (!empty($branchId)) {
                    $dueQuery .= " AND fs.branch_id = :branch_id";
                    $dueParams['branch_id'] = (int)$branchId;
                }
            } else {
                // Hostel & Transport: always scope to the student's current session
                // (same logic the FeeApiController uses when called with session_id param)
                // This prevents pulling fee_structure rows from older sessions with different amounts
                $dueQuery .= " AND fs.session_id = :fs_session_id";
                $dueParams['fs_session_id'] = (int)$student['session_id'];
            }
            $dueQuery .= " HAVING balance_due > 0 ORDER BY fs.due_date ASC, fs.fee_item_id ASC";

            $catRows = $db->execute($dueQuery, $dueParams)->fetchAll('assoc');
            foreach ($catRows as &$row) {
                $row['fee_for']            = $catCode;
                $row['fee_category_label'] = $catMap['label'];

                // Recalculate discount_amount from percent when percent > 0.
                // The stored discount_amount can be 0 if the fee structure didn't
                // exist at the time the discount was saved, making percent the
                // only reliable source of truth.
                $discPct = (float)$row['discount_percent'];
                if ($discPct > 0) {
                    $feeAmt              = (float)$row['fee_amount'];
                    $taxPct              = (float)$row['tax_percent'];
                    $effDisc             = round($feeAmt * $discPct / 100, 2);
                    $taxAmt              = round(($feeAmt - $effDisc) * $taxPct / 100, 2);
                    $netFee              = round($feeAmt - $effDisc + $taxAmt, 2);
                    $row['discount_amount'] = $effDisc;
                    $row['tax_amount']      = $taxAmt;
                    $row['net_fee_amount']  = $netFee;
                    $row['balance_due']     = round(max(0, $netFee - (float)$row['total_fee_paid']), 2);
                }
            }
            unset($row);
            // Drop rows whose balance became 0 after the correct discount was applied
            $catRows = array_values(array_filter($catRows, fn($r) => (float)$r['balance_due'] > 0));
            $ssmsFeeDueDetails = array_merge($ssmsFeeDueDetails, $catRows);
        }

        // ── Payment history grouped by receipt_number (FeeApiController-equivalent) ─
        // KEY: balance_amount in ssms_fee_paid_details is a stored snapshot that
        // goes stale with partial payments. We join a live aggregate subquery that
        // computes true_balance = fee_amount − total_ever_paid for each fee_item,
        // so each receipt item always shows the current outstanding balance.
        $rawPaidRows = $db->execute("
            SELECT
                fp.trxn_id,
                fp.receipt_number,
                fp.paid_amount,
                fp.fee_paid_amount,
                fp.late_fee,
                fp.payment_date,
                fp.fee_paid_date,
                fp.payment_method,
                fp.admin_review,
                fp.admin_user,
                fp.admin_review_date,
                fp.enrollment_id,
                fp.registration_id,
                fp.class_id,
                fp.branch_id,
                fp.session_id,
                fp.ssms_client_code,
                fp.ssms_user_name,
                fp.fee_item_id,
                fp.fee_id,
                COALESCE(fi.fee_item_name, CONCAT('Fee #', fp.fee_item_id)) AS fee_item_name,
                fs.month_no,
                fs.due_date                                      AS fee_due_date,
                fs.fee_amount                                    AS structure_fee_amount,
                COALESCE(sd.discount_percent, 0)                 AS discount_percent,
                COALESCE(sd.discount_amount,  0)                 AS discount_amount,
                COALESCE(fi.tax_percent, 0)                      AS tax_percent,
                COALESCE(fp.tax_amount, 0)                       AS tax_amount,
                ROUND(fs.fee_amount - COALESCE(sd.discount_amount, 0), 2) AS net_fee_amount,
                COALESCE(paid_total.sum_paid, 0)                 AS total_ever_paid,
                GREATEST(0, ROUND(
                    (fs.fee_amount - COALESCE(sd.discount_amount, 0))
                    - COALESCE(paid_total.sum_fee_paid, 0),
                2))                                              AS true_balance
            FROM ssms_fee_paid_details fp
            LEFT JOIN ssms_fee_items fi
                ON  fi.fee_item_id = fp.fee_item_id
            LEFT JOIN ssms_fee_structure fs
                ON  fs.fee_id      = fp.fee_id
                AND fs.fee_item_id = fp.fee_item_id
            LEFT JOIN ssms_student_discounts sd
                ON  sd.enrollment_id    = :eid_disc
                AND sd.fee_item_id      = fp.fee_item_id
                AND sd.session_id       = fp.session_id
                AND sd.ssms_client_code = fp.ssms_client_code
            LEFT JOIN (
                SELECT fee_id, fee_item_id,
                       SUM(paid_amount)                        AS sum_paid,
                       SUM(paid_amount - COALESCE(late_fee,0)) AS sum_fee_paid,
                       SUM(late_fee)                           AS sum_late_fee
                FROM   ssms_fee_paid_details
                WHERE  enrollment_id  = :eid_agg
                  AND  receipt_number != ''
                  AND  paid_amount    > 0
                GROUP BY fee_id, fee_item_id
            ) paid_total
                ON  paid_total.fee_id      = fp.fee_id
                AND paid_total.fee_item_id = fp.fee_item_id
            WHERE fp.enrollment_id   = :eid
              AND (fp.paid_amount > 0 OR fp.late_fee > 0)
              AND fp.receipt_number  != ''
              AND fp.ssms_client_code = :cc
            ORDER BY fp.payment_date DESC, fp.receipt_number ASC, fp.trxn_id ASC
        ", [
            'eid'      => $enrollmentId,
            'eid_agg'  => $enrollmentId,
            'eid_disc' => $enrollmentId,
            'cc'       => $clientCode,
        ])->fetchAll('assoc');

        // Group by receipt_number, computing totals exactly as FeeApiController does
        $receiptMap = [];
        foreach ($rawPaidRows as $row) {
            $rNo = trim((string)($row['receipt_number'] ?? ''));
            if ($rNo === '') continue;

            if (!isset($receiptMap[$rNo])) {
                $receiptMap[$rNo] = [
                    'receipt_number'    => $rNo,
                    'payment_date'      => $row['payment_date'],
                    'fee_paid_date'     => $row['fee_paid_date']     ?? null,
                    'payment_method'    => $row['payment_method']    ?? 'Cash',
                    'admin_review'      => $row['admin_review']      ?? 'Pending',
                    'admin_user'        => $row['admin_user']        ?? '',
                    'admin_review_date' => $row['admin_review_date'] ?? null,
                    'enrollment_id'     => $row['enrollment_id'],
                    'registration_id'   => $row['registration_id']  ?? null,
                    'class_id'          => $row['class_id'],
                    'branch_id'         => $row['branch_id'],
                    'session_id'        => $row['session_id'],
                    'ssms_client_code'  => $row['ssms_client_code'] ?? '',
                    'ssms_user_name'    => $row['ssms_user_name']   ?? '',
                    'total_paid'        => 0.0,
                    'total_fee'         => 0.0,
                    'total_discount'    => 0.0,
                    'total_tax'         => 0.0,
                    'total_balance'     => 0.0,
                    'total_late_fee'    => 0.0,
                    'total_collected'   => 0.0,
                    'items'             => [],
                    '_seen_fee_items'   => [],
                ];
            }

            $feeAmt      = (float)($row['fee_paid_amount']      ?? 0);
            $paidAmt     = (float)($row['paid_amount']          ?? 0);
            $late        = (float)($row['late_fee']             ?? 0);
            $trueBalance = (float)($row['true_balance']         ?? 0);
            $structFee   = (float)($row['structure_fee_amount'] ?? $feeAmt);
            $totalEver   = (float)($row['total_ever_paid']      ?? 0);
            $feeItemId   = $row['fee_item_id'];
            $discAmt     = (float)($row['discount_amount']      ?? 0);
            $discPct     = (float)($row['discount_percent']     ?? 0);
            $taxPct      = (float)($row['tax_percent']          ?? 0);
            $taxAmt      = (float)($row['tax_amount']           ?? 0);
            $netFee      = round($structFee - $discAmt, 2);

            $receiptMap[$rNo]['total_paid']      += $paidAmt;
            $receiptMap[$rNo]['total_fee']       += $feeAmt;
            $receiptMap[$rNo]['total_late_fee']  += $late;
            // total_collected = fee payments only (avoids double-counting late_fee)
            $receiptMap[$rNo]['total_collected'] += $paidAmt;

            // Count balance, discount, and tax once per fee_item
            if (!in_array($feeItemId, $receiptMap[$rNo]['_seen_fee_items'])) {
                $receiptMap[$rNo]['total_balance']     += $trueBalance;
                $receiptMap[$rNo]['total_discount']    += $discAmt;
                $receiptMap[$rNo]['total_tax']         += $taxAmt;
                $receiptMap[$rNo]['_seen_fee_items'][]  = $feeItemId;
            }

            $receiptMap[$rNo]['items'][] = [
                'trxn_id'          => $row['trxn_id'],
                'fee_id'           => $row['fee_id'],
                'fee_item_id'      => $feeItemId,
                'fee_item_name'    => $row['fee_item_name'],
                'month_no'         => $row['month_no']     ?? null,
                'fee_due_date'     => $row['fee_due_date'] ?? null,
                'fee_amount'       => round($structFee, 2),   // original full fee
                'discount_percent' => round($discPct, 2),
                'discount_amount'  => round($discAmt, 2),
                'net_fee_amount'   => $netFee,
                'tax_percent'      => round($taxPct, 2),
                'tax_amount'       => round($taxAmt, 2),
                'paid_amount'      => round($paidAmt, 2),     // this receipt only
                'total_paid'       => round($totalEver, 2),   // all-time paid
                'late_fee'         => round($late, 2),
                'balance_amount'   => round($trueBalance, 2), // live balance remaining
            ];
        }

        // Round totals and strip internal tracking key
        $ssmsFeePaidDetails = [];
        foreach ($receiptMap as &$receipt) {
            $receipt['total_paid']      = round($receipt['total_paid'],      2);
            $receipt['total_fee']       = round($receipt['total_fee'],       2);
            $receipt['total_discount']  = round($receipt['total_discount'],  2);
            $receipt['total_tax']       = round($receipt['total_tax'],       2);
            $receipt['total_balance']   = round($receipt['total_balance'],   2);
            $receipt['total_late_fee']  = round($receipt['total_late_fee'],  2);
            $receipt['total_collected'] = round($receipt['total_collected'], 2);
            unset($receipt['_seen_fee_items']);
            $ssmsFeePaidDetails[] = $receipt;
        }
        unset($receipt);

        // Pass JSON-encoded student data for AJAX use
        $ci = $this->_clientInfo();
        $jsStudent = json_encode([
            'enrollment_id'   => $enrollmentId,
            'registration_id' => $registrationId,
            'student_name'    => $studentName,
            'email_address'   => $student['email_address'] ?? '',
            'class_id'        => $student['class_id'],
            'session_id'      => $student['session_id'],
            'branch_id'       => $student['branch_id'] ?? $branchId,
            'ssms_client_code'=> $clientCode,
        ]);
        $upiId          = $ci['upi_id'];
        $upiAccountName = $ci['pay_account_name'] ?: $ci['header_text'];
        $hasRazorpay    = !empty($ci['razorpay_key_id']) && !empty($ci['razorpay_key_secret']);
        $currency       = $ci['currency'];

        $this->set(compact(
            'ssmsFeeDueDetails', 'ssmsFeePaidDetails',
            'enrollID', 'registrationId', 'feeForText', 'feeFor',
            'className', 'sessionName', 'studentName', 'jsStudent',
            'upiId', 'upiAccountName', 'hasRazorpay', 'currency'
        ));
    }

    // =========================================================================
    // COLLECT FEE — AJAX POST endpoint (port of payStudentFees)
    // POST /ssms/ssms-fee-paid-details/collect-fee
    // =========================================================================

    public function collectFee()
    {
        $this->request->allowMethod(['post']);
        $this->viewBuilder()->setClassName('Json');

        $clientCode  = $this->_clientCode();
        $userName    = $this->_userName();
        $userRole    = $this->_userRole();

        if (!in_array($userRole, ['admin', 'owner'])) {
            $this->response = $this->response->withStatus(403);
            $this->set(['success' => false, 'message' => 'Only admin/owner can collect fees.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }

        $data          = $this->request->getData();
        $enrollmentId  = $data['enrollment_id']      ?? null;
        $receiptNumber = trim((string)($data['receipt_number'] ?? ''));
        $paidAmountRaw = $data['fee_paid_amount']    ?? null;
        $feeItems      = $data['selected_fee_items'] ?? null;
        $paymentDate   = $data['payment_date']       ?? date('Y-m-d');
        $feePaidDate   = $data['fee_paid_date']      ?? date('Y-m-d');
        $paymentMethod = $data['payment_method']     ?? 'Cash';

        // Validate
        $errs = [];
        if (empty($enrollmentId))                       $errs[] = 'enrollment_id is required.';
        if ($receiptNumber === '')                       $errs[] = 'receipt_number is required.';
        if (!is_numeric($paidAmountRaw))                $errs[] = 'fee_paid_amount must be numeric.';
        if (empty($feeItems) || !is_array($feeItems))   $errs[] = 'No fee items selected.';

        if (!empty($errs)) {
            $this->response = $this->response->withStatus(422);
            $this->set(['success' => false, 'message' => implode(' ', $errs)]);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }

        $db        = ConnectionManager::get('default');
        $paidTotal = (float)$paidAmountRaw;
        $remaining = $paidTotal;
        $now       = date('Y-m-d H:i:s');
        $txns      = [];
        $receiptFeeItems = [];   // built at payment time for the email

        foreach ((array)$feeItems as $item) {
            if ($remaining <= 0) break;

            $sessionId       = !empty($item['session_id'])      ? (int)$item['session_id']      : null;
            $classId         = !empty($item['class_id'])        ? (int)$item['class_id']        : null;
            $branchId        = !empty($item['branch_id'])       ? (int)$item['branch_id']       : null;
            $registrationId  = !empty($item['registration_id']) ? (int)$item['registration_id'] : null;
            $lateFee         = (float)($item['late_fee']         ?? 0);
            $discountPercent = round((float)($item['discount_percent'] ?? 0), 2);
            $discountAmount  = round((float)($item['discount_amount']  ?? 0), 2);
            $discountReason  = trim((string)($item['discount_reason']  ?? ''));
            $taxPercent      = round((float)($item['tax_percent']      ?? 0), 2);
            $taxAmount       = round((float)($item['tax_amount']       ?? 0), 2);
            $originalFeeAmt  = round((float)($item['fee_amount']  ?? 0), 2);
            $balanceDue      = round((float)($item['balance_due'] ?? $originalFeeAmt), 2);

            $allocate  = round(min($remaining, $balanceDue + $lateFee), 2);
            $remaining = round($remaining - $allocate, 2);
            $newBal    = round(max(0, $balanceDue - ($allocate - $lateFee)), 2);

            // Prorate tax — mirrors FeeApiController::payStudentFees exactly.
            // On a partial payment only the proportional share of tax is recorded;
            // fee_paid_amount is the net base portion (no tax, no late fee).
            $netFeeAmt       = round($originalFeeAmt - $discountAmount, 2);
            $cashTowardFee   = round($allocate - $lateFee, 2);
            $totalNetWithTax = round($netFeeAmt + $taxAmount, 2);
            if ($totalNetWithTax > 0 && $taxAmount > 0) {
                $proratedTax = round($taxAmount * ($cashTowardFee / $totalNetWithTax), 2);
            } else {
                $proratedTax = 0.0;
            }

            $db->execute(
                'INSERT INTO ssms_fee_paid_details
                    (enrollment_id, registration_id, fee_id, fee_item_id,
                     session_id, class_id, branch_id, ssms_client_code,
                     receipt_number, paid_amount, fee_paid_amount, late_fee,
                     discount_percent, discount_amount, discount_reason,
                     tax_percent, tax_amount,
                     payment_date, payment_method, admin_review, admin_user,
                     ssms_user_name, enrolled, created, modified)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [
                    $enrollmentId,
                    $registrationId,
                    (int)($item['fee_id']      ?? 0),
                    (int)($item['fee_item_id'] ?? 0),
                    $sessionId,
                    $classId,
                    $branchId,
                    $clientCode,
                    $receiptNumber,
                    $allocate,                                           // paid_amount  = total cash for this item
                    round($allocate - $lateFee - $proratedTax, 2),      // fee_paid_amount = base only (no tax, no late)
                    $lateFee,
                    $discountPercent,
                    $discountAmount,
                    $discountReason,
                    $taxPercent,
                    $proratedTax,                                        // tax_amount = prorated share for this payment
                    $paymentDate,
                    $paymentMethod,
                    'Pending',
                    $userName,
                    $userName,
                    1,
                    $now,
                    $now,
                ]
            );
            $txns[] = $db->getDriver()->lastInsertId();

            // Build receipt item for email (mirrors app's payStudentFees approach)
            $receiptFeeItems[] = [
                'fee_item_name'    => trim((string)($item['fee_item_name'] ?? ('Fee #' . ($item['fee_item_id'] ?? '?')))),
                'month_no'         => $item['month_no']  ?? '',
                'fee_amount'       => $originalFeeAmt,
                'discount_percent' => $discountPercent,
                'discount_amount'  => $discountAmount,
                'tax_percent'      => $taxPercent,
                'tax_amount'       => $proratedTax,   // prorated share for this payment
                'paid_amount'      => $allocate,
                'late_fee'         => $lateFee,
                'balance_amount'   => $newBal,
            ];
        }

        // ── Auto-post to finance ledger ───────────────────────────────────────
        try {
            $this->_autoPostFeeIncome(
                $clientCode,
                $paidTotal,
                $receiptNumber,
                $paymentDate,
                $paymentMethod,
                '',         // payer name resolved below from student row
                $userName
            );
        } catch (\Throwable $e) {
            \Cake\Log\Log::error('FinAutoPost collectFee failed: ' . $e->getMessage() . ' | ' . $e->getFile() . ':' . $e->getLine());
        }

        // Auto-send receipt email if student has an email on file
        $studentRow = $db->execute(
            "SELECT r.email_address, r.student_first_name, r.student_last_name
             FROM ssms_student_enrollment e
             INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id
             WHERE e.enrollment_id = ? LIMIT 1",
            [$enrollmentId]
        )->fetchAssoc();

        if (!empty($studentRow['email_address'])) {
            $fullName = trim(($studentRow['student_first_name'] ?? '') . ' ' . ($studentRow['student_last_name'] ?? ''));
            // Pass pre-built fee items directly — avoids DB re-query and ensures
            // balance is always computed from actual request data (same as app)
            $this->_sendReceiptEmail($receiptNumber, $studentRow['email_address'], $fullName, (string)$enrollmentId, $receiptFeeItems);
        }

        $this->set([
            'success'        => true,
            'message'        => sprintf('Payment of ₹%.2f recorded against %d item(s).', $paidTotal, count($txns)),
            'receipt_number' => $receiptNumber,
            'transactions'   => $txns,
            'unallocated'    => max(0, $remaining),
        ]);
        $this->viewBuilder()->setOption('serialize', ['success', 'message', 'receipt_number', 'transactions', 'unallocated']);
    }

    // =========================================================================
    // RECEIPT — view / print a payment receipt
    // =========================================================================

    public function receipt($receiptNumber = null)
    {
        $this->viewBuilder()->setLayout(null); // standalone page — no nav/sidebar

        $clientCode = $this->_clientCode();
        $db         = ConnectionManager::get('default');

        // Get enrollment_id first (needed for discount/aggregate sub-query)
        $eidRow = $db->execute(
            "SELECT enrollment_id FROM ssms_fee_paid_details
             WHERE receipt_number = :rn AND ssms_client_code = :cc LIMIT 1",
            ['rn' => $receiptNumber, 'cc' => $clientCode]
        )->fetchAssoc();

        if (empty($eidRow)) {
            $this->Flash->error('Receipt not found.');
            return $this->redirect(['action' => 'index']);
        }
        $enrollmentId = $eidRow['enrollment_id'];

        // Receipt rows — with live true_balance + discounts
        $rows = $db->execute("
            SELECT fp.trxn_id, fp.paid_amount, fp.late_fee,
                   fp.payment_date, fp.payment_method, fp.admin_user,
                   fp.fee_id, fp.fee_item_id, fp.class_id, fp.session_id,
                   COALESCE(fi.fee_item_name, CONCAT('Fee #', fp.fee_item_id)) AS fee_item_name,
                   fs.month_no,
                   COALESCE(fs.fee_amount, fp.fee_paid_amount, 0) AS fee_amount,
                   COALESCE(sd.discount_percent, 0) AS discount_percent,
                   COALESCE(sd.discount_amount,  0) AS discount_amount,
                   COALESCE(fi.tax_percent, 0)      AS tax_percent,
                   COALESCE(fp.tax_amount, 0)       AS tax_amount,
                   GREATEST(0, ROUND(
                       (COALESCE(fs.fee_amount, fp.fee_paid_amount, 0) - COALESCE(sd.discount_amount, 0))
                       - COALESCE(paid_total.sum_fee_paid, 0)
                   , 2)) AS balance_amount
            FROM ssms_fee_paid_details fp
            LEFT JOIN ssms_fee_items fi
                ON fi.fee_item_id = fp.fee_item_id
            LEFT JOIN ssms_fee_structure fs
                ON fs.fee_id = fp.fee_id AND fs.fee_item_id = fp.fee_item_id
            LEFT JOIN ssms_student_discounts sd
                ON sd.enrollment_id  = fp.enrollment_id
               AND sd.fee_item_id   = fp.fee_item_id
               AND sd.session_id    = fp.session_id
               AND sd.class_id      = fp.class_id
               AND sd.ssms_client_code = fp.ssms_client_code
            LEFT JOIN (
                SELECT fee_id, fee_item_id,
                       SUM(paid_amount - COALESCE(late_fee, 0)) AS sum_fee_paid
                FROM   ssms_fee_paid_details
                WHERE  enrollment_id = :eid_agg AND receipt_number != '' AND paid_amount > 0
                GROUP BY fee_id, fee_item_id
            ) paid_total ON paid_total.fee_id = fp.fee_id AND paid_total.fee_item_id = fp.fee_item_id
            WHERE  fp.receipt_number   = :rn
              AND  fp.ssms_client_code = :cc
              AND  (fp.paid_amount > 0 OR fp.late_fee > 0)
            ORDER BY fp.trxn_id ASC
        ", ['rn' => $receiptNumber, 'eid_agg' => $enrollmentId, 'cc' => $clientCode])->fetchAll('assoc');

        if (empty($rows)) {
            $this->Flash->error('Receipt not found.');
            return $this->redirect(['action' => 'index']);
        }

        $first = $rows[0];

        // Student info
        $studentRow = $db->execute("
            SELECT r.student_first_name, r.student_last_name,
                   r.mobile_number, r.email_address, e.registration_id
            FROM   ssms_student_enrollment e
            INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id
            WHERE  e.enrollment_id = :eid LIMIT 1
        ", ['eid' => $enrollmentId])->fetchAssoc();

        $ci          = $this->_clientInfo();
        $schoolName  = $ci['header_text'];
        $fromAddress = !empty($ci['email']) ? $ci['email'] : (string)env('EMAIL_FROM_ADDRESS', 'admin@managemyacademy.com');

        // Build $feeItems (same structure the email template expects)
        $feeItems = [];
        foreach ($rows as $row) {
            $feeItems[] = [
                'fee_item_name'    => $row['fee_item_name'],
                'month_no'         => $row['month_no']         ?? '',
                'fee_amount'       => (float)$row['fee_amount'],
                'discount_percent' => (float)$row['discount_percent'],
                'discount_amount'  => (float)$row['discount_amount'],
                'tax_percent'      => (float)$row['tax_percent'],
                'tax_amount'       => (float)$row['tax_amount'],
                'paid_amount'      => (float)$row['paid_amount'],
                'late_fee'         => (float)$row['late_fee'],
                'balance_amount'   => (float)$row['balance_amount'],
            ];
        }

        $paidAmount    = round(array_sum(array_column($rows, 'paid_amount')), 2);
        $feeAmount     = round(array_sum(array_column($rows, 'fee_amount')), 2);
        $balanceAmount = round(array_sum(array_column($feeItems, 'balance_amount')), 2);
        $taxAmount     = round(array_sum(array_column($feeItems, 'tax_amount')), 2);
        $studentName   = trim(
            ($studentRow['student_first_name'] ?? '') . ' ' .
            ($studentRow['student_last_name']  ?? '')
        );

        // Set the SAME variable names used by fee_receipt.php
        $this->set([
            'receiptNo'      => $receiptNumber,
            'studentName'    => $studentName,
            'enrollmentId'   => $enrollmentId,
            'paidAmount'     => $paidAmount,
            'balanceAmount'  => $balanceAmount,
            'feeAmount'      => $feeAmount,
            'taxAmount'      => $taxAmount,
            'paymentDate'    => $first['payment_date'],
            'paymentMethod'  => $first['payment_method'] ?? 'Cash',
            'adminUser'      => $first['admin_user']     ?? '',
            'feeItems'       => $feeItems,
            'schoolName'     => $schoolName,
            'schoolAddress'  => $ci['address'],
            'schoolCity'     => $ci['city'],
            'schoolState'    => $ci['state'],
            'schoolZip'      => $ci['zip'],
            'schoolCurrency' => $ci['currency'],
            'fromAddress'    => $fromAddress,
            'generatedOn'    => date('d M Y, h:i A'),
            'emailAddress'   => $studentRow['email_address'] ?? '',
        ]);
    }

    // =========================================================================
    // EMAIL RECEIPT — AJAX POST, sends receipt email to a given address
    // POST /ssms-fee-paid-details/email-receipt
    // Body JSON: { email, receipt_number, enrollment_id, student_name,
    //              paid_amount, fee_amount, balance_amount,
    //              payment_date, payment_method }
    // =========================================================================

    public function emailReceipt(): void
    {
        $this->request->allowMethod(['post']);
        $this->viewBuilder()->setClassName('Json');

        $clientCode = $this->_clientCode();
        $userName   = $this->_userName();
        $db         = ConnectionManager::get('default');

        $data         = $this->request->getData();
        $email        = trim((string)($data['email']          ?? ''));
        $receiptNo    = trim((string)($data['receipt_number'] ?? ''));
        $enrollmentId = $data['enrollment_id'] ?? null;
        $studentName  = trim((string)($data['student_name']   ?? 'Student'));

        // ── Validate ─────────────────────────────────────────────────────────
        if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->response = $this->response->withStatus(422);
            $this->set(['success' => false, 'message' => 'A valid email address is required.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }
        if (empty($receiptNo)) {
            $this->response = $this->response->withStatus(422);
            $this->set(['success' => false, 'message' => 'Receipt number is required.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }

        // Verify the receipt exists before attempting to send
        $exists = $db->execute(
            "SELECT COUNT(*) AS cnt FROM ssms_fee_paid_details
             WHERE receipt_number = ? AND ssms_client_code = ?",
            [$receiptNo, $clientCode]
        )->fetchAssoc();

        if (empty($exists['cnt'])) {
            $this->response = $this->response->withStatus(404);
            $this->set(['success' => false, 'message' => 'Receipt not found.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }

        $this->_sendReceiptEmail($receiptNo, $email, $studentName, (string)$enrollmentId);

        $this->set(['success' => true, 'message' => "Receipt emailed to {$email}."]);
        $this->viewBuilder()->setOption('serialize', ['success', 'message']);
    }

    // =========================================================================
    // EMAIL DEMAND SLIP — AJAX action, sends outstanding-fee notice by email
    // =========================================================================

    public function emailDemandSlip(): void
    {
        $this->request->allowMethod(['post']);
        $this->viewBuilder()->setClassName('Json');

        $data        = $this->request->getData();
        $email       = trim((string)($data['email']        ?? ''));
        $studentName = trim((string)($data['student_name'] ?? 'Student'));
        $enrollmentId= $data['enrollment_id'] ?? null;
        $className   = trim((string)($data['class_name']   ?? ''));
        $sessionName = trim((string)($data['session_name'] ?? ''));
        $feeItems    = $data['fee_items'] ?? [];
        $totalFee    = (float)($data['total_fee']  ?? 0);
        $totalPaid   = (float)($data['total_paid'] ?? 0);
        $totalDue    = (float)($data['total_due']  ?? 0);

        if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->response = $this->response->withStatus(422);
            $this->set(['success' => false, 'message' => 'A valid email address is required.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }
        if (empty($feeItems)) {
            $this->response = $this->response->withStatus(422);
            $this->set(['success' => false, 'message' => 'No fee items provided.']);
            $this->viewBuilder()->setOption('serialize', ['success', 'message']);
            return;
        }

        $ci         = $this->_clientInfo();
        $schoolName = $ci['header_text'];
        $fromAddress= !empty($ci['email']) ? $ci['email'] : env('EMAIL_FROM_ADDRESS', 'admin@managemyacademy.com');
        $generatedOn= date('d M Y \a\t h:i A');

        $transportConfig = \Cake\Core\Configure::read('EmailTransport.default') ?? [];
        $transportClass  = $transportConfig['className'] ?? 'Mail';

        try {
            $mailer = new Mailer('default');
            $mailer
                ->setFrom([$fromAddress => $schoolName])
                ->setTo([$email => $studentName])
                ->setReplyTo([$fromAddress => $schoolName])
                ->setSubject("Fee Demand Notice — {$studentName} — {$schoolName}")
                ->setEmailFormat('html')
                ->viewBuilder()
                    ->setTemplate('fee_demand_slip')
                    ->setLayout('default')
                    ->setVars([
                        'schoolName'    => $schoolName,
                        'schoolAddress' => $ci['address'],
                        'schoolCity'    => $ci['city'],
                        'schoolState'   => $ci['state'],
                        'schoolZip'     => $ci['zip'],
                        'schoolEmail'   => $ci['email'],
                        'schoolPhone'   => $ci['phone'],
                        'studentName'   => $studentName,
                        'enrollmentId'  => $enrollmentId,
                        'className'     => $className,
                        'sessionName'   => $sessionName,
                        'totalFee'      => $totalFee,
                        'totalPaid'     => $totalPaid,
                        'totalDue'      => $totalDue,
                        'feeItems'      => $feeItems,
                        'generatedOn'   => $generatedOn,
                    ]);

            $result = $mailer->send();
            if (empty($result)) {
                throw new \RuntimeException("Mailer::send() returned empty — transport '{$transportClass}' may not be configured.");
            }

            Log::info("emailDemandSlip: SUCCESS → {$email} | student={$studentName}");
            $this->set(['success' => true, 'message' => "Demand slip emailed to {$email}."]);

        } catch (\Exception $e) {
            $errMsg = $e->getMessage();
            Log::error("emailDemandSlip FAILED: {$errMsg}");
            $this->response = $this->response->withStatus(502);
            $this->set(['success' => false, 'message' => 'Email could not be sent: ' . $errMsg]);
        }

        $this->viewBuilder()->setOption('serialize', ['success', 'message']);
    }

    // =========================================================================
    // SEND EMAIL — send receipt to student (legacy page view)
    // =========================================================================

    public function sendEmail($receiptNumber = null, $enrolId = null)
    {
        $clientCode = $this->_clientCode();
        $db         = ConnectionManager::get('default');

        // Fetch receipt rows.
        // ssms_fee_paid_details has no fee_amount column — join ssms_fee_structure
        // to get the original fee amount; fall back to fee_paid_amount when no
        // matching structure row exists (e.g. legacy data).
        $rows = $db->execute("
            SELECT fp.*,
                   COALESCE(fi.fee_item_name,'')                    AS fee_item_name,
                   COALESCE(fs.fee_amount, fp.fee_paid_amount, 0)   AS fee_amount
            FROM   ssms_fee_paid_details fp
            LEFT JOIN ssms_fee_items    fi ON fi.fee_item_id = fp.fee_item_id
            LEFT JOIN ssms_fee_structure fs ON fs.fee_id      = fp.fee_id
                                           AND fs.fee_item_id = fp.fee_item_id
            WHERE  fp.receipt_number    = :rn
              AND  fp.ssms_client_code  = :cc
        ", ['rn' => $receiptNumber, 'cc' => $clientCode])->fetchAll('assoc');

        if (empty($rows)) {
            $this->Flash->error('Receipt not found.');
            return $this->redirect(['action' => 'index']);
        }

        $this->set([
            'ssmsFeePaidDetails' => $rows,
            'receiptNumber'      => $receiptNumber,
            'enrolId'            => $enrolId,
        ]);
    }

    // =========================================================================
    // INVOICE (Demand Letter) — show fee demand for a student
    // =========================================================================

    public function invoice($enrollmentId = null, $classId = null)
    {
        $clientCode = $this->_clientCode();
        $db         = ConnectionManager::get('default');
        $today      = date('Y-m-d');

        // Student info
        $studentRow = $db->execute("
            SELECT r.student_first_name, r.student_last_name,
                   r.mobile_number, r.email_address,
                   r.student_c_address_line_1 AS cAddress1, r.student_c_address_line_2 AS cAddress2,
                   r.student_c_address_city AS city, r.student_c_address_state AS state,
                   r.student_c_address_zip AS zip, e.registration_id,
                   e.session_id, e.branch_id,
                   COALESCE(ss.session_name,'') AS session_name
            FROM   ssms_student_enrollment e
            INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id
            LEFT  JOIN ssms_sessions ss ON ss.session_id = e.session_id
            WHERE  e.enrollment_id    = :eid
              AND  e.ssms_client_code = :cc
            LIMIT 1
        ", ['eid' => $enrollmentId, 'cc' => $clientCode])->fetchAssoc();

        if (empty($studentRow)) {
            $this->Flash->error('Enrollment not found.');
            return $this->redirect(['action' => 'paymentDueList']);
        }

        $sessionId = $studentRow['session_id'];
        $branchId  = $studentRow['branch_id'];

        // Due fees from fee_structure
        $paymentInvoices = $db->execute("
            SELECT fs.fee_id, fs.fee_item_id,
                   COALESCE(fi.fee_item_name,'') AS fee_item_name,
                   COALESCE(fi.fee_code,'')      AS fee_code,
                   COALESCE(fi.fee_type,'')      AS feeType,
                   fs.fee_amount,
                   ROUND(fs.fee_amount - COALESCE(paid.total_paid,0), 2) AS balance_amount,
                   fs.class_id, fs.session_id, fs.branch_id
            FROM   ssms_fee_structure fs
            LEFT JOIN ssms_fee_items fi ON fi.fee_item_id = fs.fee_item_id
            LEFT JOIN (
                SELECT fee_id, fee_item_id, SUM(paid_amount - COALESCE(late_fee,0)) AS total_paid
                FROM   ssms_fee_paid_details
                WHERE  enrollment_id = :eid2 AND paid_amount > 0
                GROUP BY fee_id, fee_item_id
            ) paid ON paid.fee_id = fs.fee_id AND paid.fee_item_id = fs.fee_item_id
            WHERE  fs.class_id        = :cls
              AND  fs.session_id      = :sid
              AND  fs.ssms_client_code= :cc
            HAVING balance_amount > 0
            ORDER BY fs.due_date ASC
        ", [
            'eid2' => (int)$enrollmentId,
            'cls'  => (int)($classId ?? $studentRow['class_id'] ?? 0),
            'sid'  => (int)$sessionId,
            'cc'   => $clientCode,
        ])->fetchAll('assoc');

        $paymentInvoice = ['class_id' => $classId, 'branch_id' => $branchId, 'session_id' => $sessionId];
        $totalDue      = array_sum(array_column($paymentInvoices, 'balance_amount'));
        $taxPercentage = 0;
        $taxAmount     = 0;
        $finalDue      = round($totalDue + $taxAmount, 2);
        $ci            = $this->_clientInfo();

        $this->set([
            'enrolId'        => $enrollmentId,
            'regNumber'      => $studentRow['registration_id'],
            'sessionName'    => $studentRow['session_name'],
            'clientName'     => $ci['header_text'],
            'clientAddress'  => $ci['address'],
            'clientPhone'    => $ci['phone'],
            'clientEmail'    => $ci['email'],
            'firstName'      => $studentRow['student_first_name'],
            'lastName'       => $studentRow['student_last_name'],
            'cAddress1'      => $studentRow['cAddress1'] ?? '',
            'cAddress2'      => $studentRow['cAddress2'] ?? '',
            'city'           => $studentRow['city'] ?? '',
            'state'          => $studentRow['state'] ?? '',
            'zip'            => $studentRow['zip'] ?? '',
            'mobileNumber'   => $studentRow['mobile_number'] ?? '',
            'emailAddress'   => $studentRow['email_address'] ?? '',
            'paymentInvoices'=> $paymentInvoices,
            'paymentInvoice' => $paymentInvoice,
            'totalDue'       => $totalDue,
            'taxPercentage'  => $taxPercentage,
            'taxAmount'      => $taxAmount,
            'finalDue'       => $finalDue,
            'classId'        => $classId,
        ]);
    }

    // =========================================================================
    // DEMAND LETTER — printable per-student fee demand letter
    // =========================================================================

    public function demandLetter($enrollmentId = null)
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->_clientCode();
        $db         = ConnectionManager::get('default');
        $today      = date('Y-m-d');

        if (empty($enrollmentId)) {
            $this->Flash->error('Enrollment ID is required.');
            return $this->redirect(['action' => 'index']);
        }

        // ── Student + class/session info (always from school enrollment) ─────
        $student = $db->execute("
            SELECT r.registration_id,
                   r.student_first_name, r.student_last_name,
                   r.mobile_number, r.email_address,
                   r.student_c_address_line_1 AS address1,
                   r.student_c_address_line_2 AS address2,
                   r.student_c_address_city   AS city,
                   r.student_c_address_state  AS state,
                   r.student_c_address_zip    AS zip,
                   e.class_id, e.session_id, e.branch_id,
                   COALESCE(sc.class_name,   CONCAT('Class ',   e.class_id))   AS class_name,
                   COALESCE(ss.session_name, CONCAT('Session ', e.session_id)) AS session_name,
                   COALESCE(sb.branch_name,  CONCAT('Branch ',  e.branch_id))  AS branch_name
            FROM   ssms_student_enrollment e
            INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id
            LEFT  JOIN ssms_classes  sc ON sc.class_id   = e.class_id
            LEFT  JOIN ssms_sessions ss ON ss.session_id = e.session_id
            LEFT  JOIN ssms_branch   sb ON sb.branch_id  = e.branch_id
            WHERE  e.enrollment_id    = :eid
              AND  e.ssms_client_code = :cc
            LIMIT 1
        ", ['eid' => $enrollmentId, 'cc' => $clientCode])->fetchAssoc();

        if (empty($student)) {
            $this->Flash->error('Enrollment not found.');
            return $this->redirect(['action' => 'index']);
        }

        // ── Due fees — run for all 3 categories and merge ────────────────────
        $allCatMaps = [
            'SCH' => ['category' => 'Academic',  'enrTable' => 'ssms_student_enrollment',    'enrExtra' => ''],
            'HTL' => ['category' => 'Hostel',    'enrTable' => 'ssms_hostel_enrollment',      'enrExtra' => "AND enr.current_status = 'active'"],
            'TRP' => ['category' => 'Transport', 'enrTable' => 'ssms_transport_enrollments', 'enrExtra' => ''],
        ];

        $dueItems = [];
        foreach ($allCatMaps as $catCode => $catMap) {
            $enrTable = $catMap['enrTable'];
            $category = $catMap['category'];
            $enrExtra = $catMap['enrExtra'];

            $catRows = $db->execute("
                SELECT
                    fs.fee_id, fs.fee_item_id, fs.month_no, fs.due_date,
                    COALESCE(fi.fee_item_name, CONCAT('Fee #', fs.fee_item_id)) AS fee_item_name,
                    fs.fee_amount,
                    COALESCE(sd.discount_percent, 0)  AS discount_percent,
                    COALESCE(sd.discount_amount,  0)  AS discount_amount,
                    COALESCE(fi.tax_percent, 0)        AS tax_percent,
                    ROUND(
                        (fs.fee_amount - COALESCE(sd.discount_amount, 0))
                        * COALESCE(fi.tax_percent, 0) / 100,
                    2)                                 AS tax_amount,
                    ROUND(
                        (fs.fee_amount - COALESCE(sd.discount_amount, 0))
                        + ROUND(
                            (fs.fee_amount - COALESCE(sd.discount_amount, 0))
                            * COALESCE(fi.tax_percent, 0) / 100,
                        2),
                    2)                                 AS net_fee_amount,
                    COALESCE(paid_agg.total_fee_paid, 0) AS total_fee_paid,
                    ROUND(
                        (fs.fee_amount - COALESCE(sd.discount_amount, 0)
                         + ROUND(
                               (fs.fee_amount - COALESCE(sd.discount_amount, 0))
                               * COALESCE(fi.tax_percent, 0) / 100,
                           2))
                        - COALESCE(paid_agg.total_fee_paid, 0),
                    2)                                 AS balance_due
                FROM ssms_fee_structure fs
                LEFT JOIN ssms_fee_items fi
                    ON  fi.fee_item_id = fs.fee_item_id
                    AND fi.category    = :category
                    AND fs.due_date    < :today
                LEFT JOIN (
                    SELECT fp.fee_id, fp.fee_item_id,
                           SUM(fp.paid_amount - COALESCE(fp.late_fee, 0)) AS total_fee_paid
                    FROM   ssms_fee_paid_details fp
                    WHERE  fp.enrollment_id  = :eid_agg
                      AND  fp.receipt_number != ''
                      AND  fp.paid_amount    > 0
                    GROUP BY fp.fee_id, fp.fee_item_id
                ) paid_agg
                    ON  paid_agg.fee_id      = fs.fee_id
                    AND paid_agg.fee_item_id = fs.fee_item_id
                LEFT JOIN ssms_student_discounts sd
                    ON  sd.enrollment_id    = :eid_disc
                    AND sd.fee_item_id      = fs.fee_item_id
                    AND sd.session_id       = fs.session_id
                    AND sd.ssms_client_code = fs.ssms_client_code
                INNER JOIN {$enrTable} enr
                    ON  enr.class_id      = fs.class_id
                    AND enr.session_id    = fs.session_id
                    AND fi.category       = :category2
                    AND enr.enrollment_id = :eid_enr
                    {$enrExtra}
                WHERE fs.ssms_client_code = :cc
                  AND fs.fee_id = (
                      SELECT MIN(fs2.fee_id)
                      FROM   ssms_fee_structure fs2
                      WHERE  fs2.fee_item_id      = fs.fee_item_id
                        AND  fs2.month_no         = fs.month_no
                        AND  fs2.class_id         = fs.class_id
                        AND  fs2.session_id       = fs.session_id
                        AND  fs2.ssms_client_code = fs.ssms_client_code
                  )
                HAVING balance_due > 0
                ORDER BY fs.due_date ASC, fs.fee_item_id ASC
            ", [
                'category'  => $category,
                'category2' => $category,
                'today'     => $today,
                'eid_agg'   => $enrollmentId,
                'eid_disc'  => $enrollmentId,
                'eid_enr'   => $enrollmentId,
                'cc'        => $clientCode,
            ])->fetchAll('assoc');

            // Recalculate discount from percent; filter zero-balance rows
            foreach ($catRows as &$row) {
                $discPct = (float)$row['discount_percent'];
                if ($discPct > 0) {
                    $feeAmt              = (float)$row['fee_amount'];
                    $taxPct              = (float)$row['tax_percent'];
                    $effDisc             = round($feeAmt * $discPct / 100, 2);
                    $taxAmt              = round(($feeAmt - $effDisc) * $taxPct / 100, 2);
                    $netFee              = round($feeAmt - $effDisc + $taxAmt, 2);
                    $row['discount_amount'] = $effDisc;
                    $row['tax_amount']      = $taxAmt;
                    $row['net_fee_amount']  = $netFee;
                    $row['balance_due']     = round(max(0, $netFee - (float)$row['total_fee_paid']), 2);
                }
            }
            unset($row);
            $catRows  = array_values(array_filter($catRows, fn($r) => (float)$r['balance_due'] > 0));
            $dueItems = array_merge($dueItems, $catRows);
        }

        // Sort all due items by due_date then fee_item_id
        usort($dueItems, fn($a, $b) => strcmp($a['due_date'], $b['due_date']) ?: ($a['fee_item_id'] <=> $b['fee_item_id']));

        // ── Totals ────────────────────────────────────────────────────────────
        $totalFee      = round(array_sum(array_column($dueItems, 'fee_amount')),      2);
        $totalDiscount = round(array_sum(array_column($dueItems, 'discount_amount')), 2);
        $totalTax      = round(array_sum(array_column($dueItems, 'tax_amount')),      2);
        $totalPaid     = round(array_sum(array_column($dueItems, 'total_fee_paid')),  2);
        $totalDue      = round(array_sum(array_column($dueItems, 'balance_due')),     2);

        $ci = $this->_clientInfo();

        $this->set(compact(
            'enrollmentId', 'student', 'dueItems',
            'totalFee', 'totalDiscount', 'totalTax', 'totalPaid', 'totalDue',
            'ci', 'today'
        ));
    }

    // =========================================================================
    // PAYMENT DUE LIST — student-level outstanding fees
    // =========================================================================

    public function paymentDueList()
    {
        $clientCode = $this->_clientCode();
        $db         = ConnectionManager::get('default');

        // Dropdown data
        $ssmsClasses    = $db->execute("SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code = :cc ORDER BY class_name", ['cc' => $clientCode])->fetchAll('assoc');
        $ssmsSessions   = $db->execute("SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code = :cc ORDER BY session_id DESC", ['cc' => $clientCode])->fetchAll('assoc');
        $ssmsBranchList = $db->execute("SELECT branch_id, branch_name FROM ssms_branch WHERE ssms_client_code = :cc ORDER BY branch_name", ['cc' => $clientCode])->fetchAll('assoc');

        $ssmsFeeDuelist = [];
        $classId = $sessionId = $branchId = null;

        if ($this->request->is('post') || !empty($this->request->getQueryParams())) {
            $data      = $this->request->is('post') ? $this->request->getData() : $this->request->getQueryParams();
            $classId   = $data['class_id']   ?? null;
            $sessionId = $data['session_id'] ?? null;
            $branchId  = $data['branch_id']  ?? null;

            if (!empty($classId) && !empty($sessionId)) {
                // Effective discount = recalculated from percent (matches demandLetter PHP post-processing)
                // Paid = paid_amount minus late_fee, confirmed receipts only
                // MIN(fee_id) deduplication prevents inflated totals from duplicate fee_structure rows
                $sql = "
                    SELECT
                        e.enrollment_id, e.class_id, e.session_id, e.branch_id,
                        COALESCE(sb.branch_name, '') AS branch_name,
                        COALESCE(ss.session_name,'') AS session_name,
                        COALESCE(sc.class_name, '')  AS class_name,
                        r.student_first_name, r.student_last_name,
                        ROUND(SUM(GREATEST(0,
                            (fs.fee_amount
                                - ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2)
                                + ROUND(
                                    (fs.fee_amount - ROUND(fs.fee_amount * COALESCE(sd.discount_percent, 0) / 100, 2))
                                    * COALESCE(fi.tax_percent, 0) / 100,
                                  2))
                            - COALESCE(paid.sum_paid, 0)
                        )), 2) AS total
                    FROM ssms_student_enrollment e
                    INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                    INNER JOIN ssms_fee_structure fs
                        ON  fs.class_id         = e.class_id
                        AND fs.session_id       = e.session_id
                        AND fs.ssms_client_code = e.ssms_client_code
                        AND fs.fee_id = (
                            SELECT MIN(fs2.fee_id)
                            FROM   ssms_fee_structure fs2
                            WHERE  fs2.fee_item_id      = fs.fee_item_id
                              AND  fs2.month_no         = fs.month_no
                              AND  fs2.class_id         = fs.class_id
                              AND  fs2.session_id       = fs.session_id
                              AND  fs2.ssms_client_code = fs.ssms_client_code
                        )
                    LEFT JOIN ssms_fee_items fi
                        ON  fi.fee_item_id      = fs.fee_item_id
                        AND fi.ssms_client_code = e.ssms_client_code
                    LEFT JOIN ssms_hostel_enrollment he
                        ON  he.enrollment_id    = e.enrollment_id
                        AND he.current_status   = 'active'
                    LEFT JOIN ssms_transport_enrollments te
                        ON  te.enrollment_id    = e.enrollment_id
                    LEFT JOIN ssms_student_discounts sd
                        ON  sd.enrollment_id    = e.enrollment_id
                        AND sd.fee_item_id      = fs.fee_item_id
                        AND sd.session_id       = fs.session_id
                        AND sd.ssms_client_code = fs.ssms_client_code
                    LEFT JOIN (
                        SELECT fee_id, fee_item_id, enrollment_id,
                               SUM(paid_amount - COALESCE(late_fee, 0)) AS sum_paid
                        FROM   ssms_fee_paid_details
                        WHERE  paid_amount    > 0
                          AND  receipt_number != ''
                        GROUP BY fee_id, fee_item_id, enrollment_id
                    ) paid ON paid.fee_id         = fs.fee_id
                           AND paid.fee_item_id   = fs.fee_item_id
                           AND paid.enrollment_id = e.enrollment_id
                    LEFT JOIN ssms_classes  sc ON sc.class_id   = e.class_id
                    LEFT JOIN ssms_sessions ss ON ss.session_id = e.session_id
                    LEFT JOIN ssms_branch   sb ON sb.branch_id  = e.branch_id
                    WHERE  e.class_id         = :cls
                      AND  e.session_id       = :sid
                      AND  e.ssms_client_code = :cc
                      AND  fs.due_date        < CURDATE()
                      AND  (
                               fi.category IS NULL
                            OR fi.category = 'Academic'
                            OR (fi.category = 'Hostel'    AND he.enrollment_id IS NOT NULL)
                            OR (fi.category = 'Transport' AND te.enrollment_id IS NOT NULL)
                           )
                ";
                $params = ['cls' => (int)$classId, 'sid' => (int)$sessionId, 'cc' => $clientCode];
                if (!empty($branchId)) {
                    $sql .= " AND e.branch_id = :bid";
                    $params['bid'] = (int)$branchId;
                }
                $sql .= "
                    GROUP BY e.enrollment_id, e.class_id, e.session_id, e.branch_id,
                             r.student_first_name, r.student_last_name,
                             sc.class_name, ss.session_name, sb.branch_name
                    HAVING total > 0
                    ORDER BY r.student_first_name ASC
                ";
                $ssmsFeeDuelist = $db->execute($sql, $params)->fetchAll('assoc');
            }
        }

        $ssmsFeePaidDetails = null; // needed by payment_due_list.php form helper
        $currency = $this->_clientInfo()['currency'];
        $this->set(compact('ssmsClasses', 'ssmsSessions', 'ssmsBranchList',
            'ssmsFeeDuelist', 'ssmsFeePaidDetails', 'classId', 'sessionId', 'branchId', 'currency'));
    }

    // =========================================================================
    // PAYMENT DUE BY CLASS — class-level outstanding summary
    // =========================================================================

    public function paymentDueByClass()
    {
        $clientCode = $this->_clientCode();
        $db         = ConnectionManager::get('default');

        $ssmsClasses    = $db->execute("SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code=:cc ORDER BY class_name", ['cc' => $clientCode])->fetchAll('assoc');
        $ssmsSessions   = $db->execute("SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code=:cc ORDER BY session_id DESC", ['cc' => $clientCode])->fetchAll('assoc');
        $ssmsBranchList = $db->execute("SELECT branch_id, branch_name FROM ssms_branch WHERE ssms_client_code=:cc ORDER BY branch_name", ['cc' => $clientCode])->fetchAll('assoc');

        $feeCategories = [
            'ALL' => ['label' => 'All Categories', 'category' => null,       'enrTable' => null],
            'SCH' => ['label' => 'Academic',       'category' => 'Academic',  'enrTable' => 'ssms_student_enrollment'],
            'HTL' => ['label' => 'Hostel',         'category' => 'Hostel',    'enrTable' => 'ssms_hostel_enrollment'],
            'TRP' => ['label' => 'Transport',      'category' => 'Transport', 'enrTable' => 'ssms_transport_enrollments'],
        ];

        $classData      = [];
        $summary        = null;
        $hasLoaded      = false;
        $classId        = null;
        $sessionId      = $branchId = null;
        $feeFor         = 'ALL';
        $selSessionName = '';
        $selBranchName  = '';

        if ($this->request->is('post')) {
            $d         = $this->request->getData();
            $sessionId = $d['session_id'] ?? null;
            $branchId  = $d['branch_id']  ?? null;
            $feeFor    = in_array($d['fee_for'] ?? '', ['ALL','SCH','HTL','TRP'], true) ? $d['fee_for'] : 'ALL';

            // Resolve display names for chips
            foreach ($ssmsSessions   as $s) { if ((string)$s['session_id'] === (string)$sessionId) { $selSessionName = $s['session_name']; break; } }
            foreach ($ssmsBranchList as $b) { if ((string)$b['branch_id']  === (string)$branchId)  { $selBranchName  = $b['branch_name'];  break; } }

            // Determine which categories to run
            $runCategories = $feeFor === 'ALL'
                ? ['SCH', 'HTL', 'TRP']
                : [$feeFor];

            if (!empty($sessionId)) {
                // Build reusable SQL template — enrTable & category substituted per iteration
                $classMap = []; // keyed by class_id for merging across categories

                foreach ($runCategories as $catKey) {
                    $feeMap   = $feeCategories[$catKey];
                    $category = $feeMap['category'];
                    $enrTable = $feeMap['enrTable'];

                    $sql = "
                        SELECT
                            sc.class_id,
                            sc.class_name,
                            COUNT(DISTINCT e.enrollment_id) AS student_count,
                            ROUND(SUM(
                                fs.fee_amount
                                - COALESCE(sd.discount_amount, 0)
                                + ROUND((fs.fee_amount - COALESCE(sd.discount_amount, 0)) * COALESCE(fi.tax_percent, 0) / 100, 2)
                            ), 2) AS total_fee,
                            ROUND(SUM(COALESCE(paid.sum_paid, 0)), 2) AS total_paid,
                            ROUND(SUM(GREATEST(0,
                                fs.fee_amount
                                - COALESCE(sd.discount_amount, 0)
                                + ROUND((fs.fee_amount - COALESCE(sd.discount_amount, 0)) * COALESCE(fi.tax_percent, 0) / 100, 2)
                                - COALESCE(paid.sum_paid, 0)
                            )), 2) AS total_due
                        FROM ssms_classes sc
                        INNER JOIN {$enrTable} e
                            ON  e.class_id         = sc.class_id
                            AND e.session_id       = :sid
                            AND e.ssms_client_code = :cc
                        INNER JOIN ssms_fee_structure fs
                            ON  fs.class_id         = e.class_id
                            AND fs.session_id       = e.session_id
                            AND fs.ssms_client_code = e.ssms_client_code
                        INNER JOIN ssms_fee_items fi
                            ON  fi.fee_item_id = fs.fee_item_id
                            AND fi.category    = :cat
                        LEFT JOIN ssms_student_discounts sd
                            ON  sd.enrollment_id    = e.enrollment_id
                            AND sd.fee_item_id      = fs.fee_item_id
                            AND sd.session_id       = fs.session_id
                            AND sd.class_id         = fs.class_id
                            AND sd.ssms_client_code = fs.ssms_client_code
                        LEFT JOIN (
                            SELECT fee_id, fee_item_id, enrollment_id,
                                   SUM(paid_amount - COALESCE(late_fee, 0)) AS sum_paid
                            FROM   ssms_fee_paid_details
                            WHERE  paid_amount > 0
                            GROUP BY fee_id, fee_item_id, enrollment_id
                        ) paid
                            ON  paid.fee_id        = fs.fee_id
                            AND paid.fee_item_id   = fs.fee_item_id
                            AND paid.enrollment_id = e.enrollment_id
                        WHERE sc.ssms_client_code = :cc2
                    ";
                    $params = [
                        'sid' => (int)$sessionId,
                        'cc'  => $clientCode,
                        'cat' => $category,
                        'cc2' => $clientCode,
                    ];
                    if (!empty($branchId)) { $sql .= " AND e.branch_id = :bid"; $params['bid'] = (int)$branchId; }
                    $sql .= " GROUP BY sc.class_id, sc.class_name";

                    $rows = $db->execute($sql, $params)->fetchAll('assoc');
                    foreach ($rows as $row) {
                        $cid = $row['class_id'];
                        if (!isset($classMap[$cid])) {
                            $classMap[$cid] = [
                                'class_id'      => $cid,
                                'class_name'    => $row['class_name'],
                                'student_count' => 0,
                                'total_fee'     => 0.0,
                                'total_paid'    => 0.0,
                                'total_due'     => 0.0,
                            ];
                        }
                        $classMap[$cid]['student_count'] += (int)$row['student_count'];
                        $classMap[$cid]['total_fee']     += (float)$row['total_fee'];
                        $classMap[$cid]['total_paid']    += (float)$row['total_paid'];
                        $classMap[$cid]['total_due']     += (float)$row['total_due'];
                    }
                }

                // Round merged values, filter classes with no dues, sort by name
                foreach ($classMap as &$c) {
                    $c['total_fee']  = round($c['total_fee'],  2);
                    $c['total_paid'] = round($c['total_paid'], 2);
                    $c['total_due']  = round($c['total_due'],  2);
                }
                unset($c);
                $classData = array_values(array_filter($classMap, fn($c) => $c['total_due'] > 0));
                usort($classData, fn($a, $b) => strcmp($a['class_name'], $b['class_name']));
                $hasLoaded = true;

                if (!empty($classData)) {
                    $summary = [
                        'class_count'   => count($classData),
                        'student_count' => array_sum(array_column($classData, 'student_count')),
                        'total_fee'     => round(array_sum(array_column($classData, 'total_fee')),  2),
                        'total_paid'    => round(array_sum(array_column($classData, 'total_paid')), 2),
                        'total_due'     => round(array_sum(array_column($classData, 'total_due')),  2),
                    ];
                }
            }
        }

        $currency = $this->_clientInfo()['currency'];
        $this->set(compact(
            'ssmsClasses', 'ssmsSessions', 'ssmsBranchList', 'feeCategories',
            'classData', 'summary', 'hasLoaded',
            'classId', 'sessionId', 'branchId', 'feeFor',
            'selSessionName', 'selBranchName', 'currency'
        ));
    }

    // =========================================================================
    // UPDATE STUDENT FEE — customise fee amounts per student
    // =========================================================================

    public function updateStudentFee()
    {
        $clientCode = $this->_clientCode();
        $db         = ConnectionManager::get('default');

        $regIdOrEnrolId      = null;
        $feeFor              = 'SCH';
        $searchResults       = [];
        $ssmsFeeDisabledDetails = [];
        $enabledFeeItemCount = 0;
        $disabledFeeItemCount = 0;

        if ($this->request->is('post')) {
            $d              = $this->request->getData();
            $regIdOrEnrolId = trim((string)($d['registration_id'] ?? ''));
            $feeFor         = $d['fee_for'] ?? 'SCH';

            // Update fees if submitted
            if (isset($d['btnUpdate']) && !empty($d['change_amount']) && !empty($d['enrollment_id'])) {
                $enrollId = $d['enrollment_id'];
                foreach ($d['change_amount'] as $feeItemId => $newAmount) {
                    $db->execute(
                        "UPDATE ssms_fee_paid_details
                         SET    fee_amount = ?, balance_amount = fee_amount - paid_amount, modified = NOW()
                         WHERE  enrollment_id = ? AND fee_item_id = ? AND ssms_client_code = ?",
                        [(float)$newAmount, $enrollId, (int)$feeItemId, $clientCode]
                    );
                }
                $this->Flash->success('Fee amounts updated successfully.');
            }

            // Search for student
            if (!empty($regIdOrEnrolId)) {
                $feeMap   = $this->_feeForMap($feeFor);
                $category = $feeMap['category'];

                $searchResults = $db->execute("
                    SELECT fp.trxn_id, fp.fee_item_id, fp.enrollment_id, fp.paid_amount,
                           fp.balance_amount, fp.fee_amount AS original_fee, fp.enrolled,
                           COALESCE(fi.fee_item_name,'') AS fee_item_name,
                           fp.fee_amount,
                           r.student_first_name, r.student_last_name,
                           sc.class_name, COALESCE(ss.session_name,'') AS session_name,
                           e.enrollment_id
                    FROM   ssms_fee_paid_details fp
                    INNER JOIN ssms_student_enrollment e   ON e.enrollment_id = fp.enrollment_id
                    INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                    LEFT  JOIN ssms_fee_items fi  ON fi.fee_item_id = fp.fee_item_id AND fi.category = :cat
                    LEFT  JOIN ssms_classes   sc  ON sc.class_id   = fp.class_id
                    LEFT  JOIN ssms_sessions  ss  ON ss.session_id = fp.session_id
                    WHERE  fp.ssms_client_code = :cc
                      AND  fp.enrolled         = 1
                      AND (e.enrollment_id     = :q1
                           OR r.registration_id = :q2
                           OR CONCAT(r.student_first_name,' ',r.student_last_name) LIKE :q3)
                ", [
                    'cat' => $category,
                    'cc'  => $clientCode,
                    'q1'  => $regIdOrEnrolId,
                    'q2'  => $regIdOrEnrolId,
                    'q3'  => "%{$regIdOrEnrolId}%",
                ])->fetchAll('assoc');

                $enabledFeeItemCount = count($searchResults);

                // Disabled / de-enrolled fees
                $ssmsFeeDisabledDetails = $db->execute("
                    SELECT fp.trxn_id, fp.fee_item_id, fp.enrollment_id, fp.fee_amount,
                           fp.enrolled, COALESCE(fi.fee_item_name,'') AS fee_item_name,
                           r.student_first_name, r.student_last_name,
                           sc.class_name, COALESCE(ss.session_name,'') AS session_name
                    FROM   ssms_fee_paid_details fp
                    INNER JOIN ssms_student_enrollment e   ON e.enrollment_id = fp.enrollment_id
                    INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                    LEFT  JOIN ssms_fee_items fi ON fi.fee_item_id = fp.fee_item_id
                    LEFT  JOIN ssms_classes  sc  ON sc.class_id   = fp.class_id
                    LEFT  JOIN ssms_sessions ss  ON ss.session_id = fp.session_id
                    WHERE  fp.ssms_client_code = :cc
                      AND  fp.enrolled         = 0
                      AND (e.enrollment_id = :q1 OR r.registration_id = :q2
                           OR CONCAT(r.student_first_name,' ',r.student_last_name) LIKE :q3)
                ", ['cc' => $clientCode, 'q1' => $regIdOrEnrolId, 'q2' => $regIdOrEnrolId, 'q3' => "%{$regIdOrEnrolId}%"])->fetchAll('assoc');

                $disabledFeeItemCount = count($ssmsFeeDisabledDetails);
            }
        }

        $this->set(compact(
            'regIdOrEnrolId', 'feeFor',
            'searchResults', 'ssmsFeeDisabledDetails',
            'enabledFeeItemCount', 'disabledFeeItemCount'
        ));
    }

    // =========================================================================
    // RE-ENROLL — re-activate a de-enrolled fee item
    // =========================================================================

    public function reEnroll($encryptedParam = null)
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->_clientCode();
        $db         = ConnectionManager::get('default');

        // Decrypt: trxn_id|fee_item_id|enrollment_id|fee_amount|fee_for
        $decrypted = $encryptedParam ? $this->_decrypt($encryptedParam) : '';
        [$trxnId, $feeItemId, $enrollmentId, $feeAmount, $feeFor] = array_pad(explode('|', $decrypted), 5, '');

        if (empty($trxnId)) {
            $this->Flash->error('Invalid re-enroll request.');
            return $this->redirect(['action' => 'updateStudentFee']);
        }

        $db->execute(
            "UPDATE ssms_fee_paid_details SET enrolled = 1, modified = NOW()
             WHERE  trxn_id = ? AND ssms_client_code = ?",
            [(int)$trxnId, $clientCode]
        );

        $this->Flash->success('Fee item re-enrolled successfully.');
        return $this->redirect(['action' => 'updateStudentFee']);
    }

    // =========================================================================
    // DEENROLL FEE — view/remove fee items for a student
    // =========================================================================

    public function deenrollFee($regIdOrEnrolId = null, $feeFor = 'SCH')
    {
        $clientCode = $this->_clientCode();
        $db         = ConnectionManager::get('default');

        $feeItemList = [];
        if (!empty($regIdOrEnrolId)) {
            $feeItemList = $db->execute("
                SELECT fp.trxn_id, fp.fee_item_id, fp.enrollment_id,
                       COALESCE(fi.fee_item_name,'') AS fee_item_name,
                       fp.fee_amount,
                       COALESCE(ss.session_name,'')  AS session_name
                FROM   ssms_fee_paid_details fp
                INNER JOIN ssms_student_enrollment e   ON e.enrollment_id = fp.enrollment_id
                LEFT  JOIN ssms_fee_items fi   ON fi.fee_item_id = fp.fee_item_id
                LEFT  JOIN ssms_sessions  ss   ON ss.session_id  = fp.session_id
                INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id
                WHERE  fp.ssms_client_code = :cc
                  AND  fp.enrolled         = 1
                  AND  fp.paid_amount      = 0
                  AND (e.enrollment_id = :q OR r.registration_id = :q2)
                ORDER BY ss.session_id DESC, fi.fee_item_name ASC
            ", ['cc' => $clientCode, 'q' => $regIdOrEnrolId, 'q2' => $regIdOrEnrolId])->fetchAll('assoc');
        }

        // POST: remove a fee item
        if ($this->request->is('post')) {
            $trxnId = $this->request->getData('trxn_id');
            if (!empty($trxnId)) {
                $db->execute(
                    "UPDATE ssms_fee_paid_details SET enrolled = 0, modified = NOW() WHERE trxn_id = ? AND ssms_client_code = ?",
                    [(int)$trxnId, $clientCode]
                );
                $this->Flash->success('Fee item removed.');
                return $this->redirect(['action' => 'deenrollFee', $regIdOrEnrolId, $feeFor]);
            }
        }

        $this->set(compact('feeItemList', 'regIdOrEnrolId', 'feeFor'));
    }

    // =========================================================================
    // FEE COLLECTION REPORT — pending admin review receipts
    // =========================================================================

    public function feeCollectionReport()
    {
        $clientCode = $this->_clientCode();
        $db         = ConnectionManager::get('default');

        // Filter params
        $filters = $this->request->getQueryParams();
        $where   = ["fp.admin_review IN ('Pending','Under Review')", "fp.paid_amount > 0", "fp.receipt_number != ''"];
        $params  = ['cc' => $clientCode];
        $where[] = "fp.ssms_client_code = :cc";

        if (!empty($filters['branch_id']))    { $where[] = "fp.branch_id  = :bid";   $params['bid']   = (int)$filters['branch_id']; }
        if (!empty($filters['session_id']))   { $where[] = "fp.session_id = :sid";   $params['sid']   = (int)$filters['session_id']; }
        if (!empty($filters['class_id']))     { $where[] = "fp.class_id   = :cid";   $params['cid']   = (int)$filters['class_id']; }
        if (!empty($filters['date_from']))    { $where[] = "fp.payment_date >= :df";  $params['df']    = $filters['date_from']; }
        if (!empty($filters['date_to']))      { $where[] = "fp.payment_date <= :dt";  $params['dt']    = $filters['date_to']; }
        if (!empty($filters['collected_by'])) { $where[] = "fp.ssms_user_name = :cu"; $params['cu']    = $filters['collected_by']; }

        $sql = "
            SELECT fp.trxn_id, fp.receipt_number, fp.paid_amount, fp.late_fee,
                   fp.payment_date, fp.payment_method, fp.admin_review,
                   fp.enrollment_id, fp.class_id, fp.session_id, fp.branch_id,
                   fp.ssms_user_name AS collected_by, fp.fee_item_id,
                   COALESCE(fi.fee_item_name,'') AS fee_item_name,
                   COALESCE(sc.class_name, '')   AS class_name,
                   COALESCE(ss.session_name,'')  AS session_name,
                   COALESCE(sb.branch_name, '')  AS branch_name,
                   TRIM(CONCAT_WS(' ', r.student_first_name, r.student_last_name)) AS student_name
            FROM   ssms_fee_paid_details fp
            LEFT JOIN ssms_fee_items    fi   ON fi.fee_item_id = fp.fee_item_id
            LEFT JOIN ssms_classes      sc   ON sc.class_id    = fp.class_id
            LEFT JOIN ssms_sessions     ss   ON ss.session_id  = fp.session_id
            LEFT JOIN ssms_branch       sb   ON sb.branch_id   = fp.branch_id
            LEFT JOIN ssms_student_enrollment enr ON enr.enrollment_id = fp.enrollment_id
            LEFT JOIN ssms_student_registration r  ON r.registration_id = enr.registration_id
            WHERE  " . implode(' AND ', $where) . "
            ORDER BY fp.payment_date DESC, fp.receipt_number ASC
        ";

        $rows = $db->execute($sql, $params)->fetchAll('assoc');

        // Group by receipt
        $receiptMap = [];
        foreach ($rows as $row) {
            $rNo = $row['receipt_number'];
            if (!isset($receiptMap[$rNo])) {
                $receiptMap[$rNo] = [
                    'receipt_number' => $rNo,
                    'payment_date'   => $row['payment_date'],
                    'payment_method' => $row['payment_method'] ?? 'Cash',
                    'admin_review'   => $row['admin_review'] ?? 'Pending',
                    'enrollment_id'  => $row['enrollment_id'],
                    'student_name'   => trim($row['student_name'] ?? ''),
                    'class_name'     => $row['class_name'] ?? '',
                    'session_name'   => $row['session_name'] ?? '',
                    'branch_name'    => $row['branch_name'] ?? '',
                    'collected_by'   => $row['collected_by'] ?? '',
                    'total_paid'     => 0.0,
                    'total_late_fee' => 0.0,
                    'items'          => [],
                ];
            }
            $receiptMap[$rNo]['total_paid']     += (float)$row['paid_amount'];
            $receiptMap[$rNo]['total_late_fee'] += (float)$row['late_fee'];
            $receiptMap[$rNo]['items'][]         = $row;
        }
        // Add computed totals per receipt
        foreach ($receiptMap as &$rpt) {
            $rpt['total_collected'] = round($rpt['total_paid'] + $rpt['total_late_fee'], 2);
        }
        unset($rpt);
        $pendingReceipts = array_values($receiptMap);

        // By-user collection summary (pending only)
        $summaryByUser = $db->execute("
            SELECT ssms_user_name AS collector,
                   COUNT(DISTINCT receipt_number) AS receipt_count,
                   ROUND(SUM(paid_amount),2) AS total_collected
            FROM   ssms_fee_paid_details
            WHERE  admin_review IN ('Pending','Under Review') AND paid_amount > 0
              AND  receipt_number != '' AND ssms_client_code = :cc
            GROUP BY ssms_user_name
            ORDER BY total_collected DESC
        ", ['cc' => $clientCode])->fetchAll('assoc');

        // Approved today summary
        $today       = date('Y-m-d');
        $approvedRow = $db->execute("
            SELECT COUNT(DISTINCT receipt_number) AS approved_today,
                   ROUND(SUM(paid_amount),2)      AS approved_amount_today
            FROM   ssms_fee_paid_details
            WHERE  admin_review = 'Complete' AND DATE(admin_review_date) = :td
              AND  paid_amount > 0 AND ssms_client_code = :cc
        ", ['td' => $today, 'cc' => $clientCode])->fetchAssoc();

        $totalPending = round(array_sum(array_column($pendingReceipts, 'total_paid')), 2);

        $summary = [
            'pending_count'         => count($pendingReceipts),
            'total_pending_amount'  => $totalPending,
            'approved_today'        => (int)($approvedRow['approved_today']       ?? 0),
            'approved_amount_today' => (float)($approvedRow['approved_amount_today'] ?? 0),
        ];

        $userRole = $this->request->getSession()->read('ssms_user_role') ?? '';
        $currency = $this->_clientInfo()['currency'];

        $this->set(compact('pendingReceipts', 'summaryByUser', 'totalPending', 'summary', 'filters', 'userRole', 'currency'));
    }

    // =========================================================================
    // APPROVE COLLECTION — mark receipts Complete + post to balance sheet
    // =========================================================================

    public function approveCollection()
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->_clientCode();
        $userName   = $this->_userName();
        $db         = ConnectionManager::get('default');
        $today      = date('Y-m-d H:i:s');
        $todayDate  = date('Y-m-d');

        // Accept both JSON body (AJAX fetch) and regular form POST
        $isJson = str_contains($this->request->getHeaderLine('Content-Type'), 'application/json');
        if ($isJson) {
            $body   = json_decode((string)$this->request->getBody(), true) ?? [];
            $receiptNumbers = (array)($body['receipt_numbers'] ?? []);
        } else {
            $receiptNumbers = (array)($this->request->getData('receipt_numbers') ?? []);
        }

        if (empty($receiptNumbers)) {
            if ($isJson) {
                $this->response = $this->response->withType('application/json')
                    ->withStringBody(json_encode(['status' => false, 'message' => 'No receipts selected.']));
                return $this->response;
            }
            $this->Flash->error('No receipts selected.');
            return $this->redirect(['action' => 'feeCollectionReport']);
        }

        $placeholders = implode(',', array_fill(0, count($receiptNumbers), '?'));
        $receiptRows  = $db->execute(
            "SELECT receipt_number, SUM(paid_amount) + SUM(COALESCE(late_fee,0)) AS total_amount,
                    MAX(ssms_client_code) AS ssms_client_code
             FROM   ssms_fee_paid_details
             WHERE  receipt_number IN ({$placeholders})
               AND  admin_review IN ('Pending','Under Review')
             GROUP BY receipt_number",
            array_values($receiptNumbers)
        )->fetchAll('assoc');

        if (empty($receiptRows)) {
            $this->Flash->error('No matching pending receipts found.');
            return $this->redirect(['action' => 'feeCollectionReport']);
        }

        // Running balance
        $balRow         = $db->execute(
            "SELECT COALESCE(balance, 0) AS balance FROM ssms_balancesheet WHERE ssms_client_code = ? ORDER BY id DESC LIMIT 1",
            [$clientCode]
        )->fetchAssoc();
        $runningBalance = (float)($balRow['balance'] ?? 0);

        $db->begin();
        try {
            $approved = 0;
            foreach ($receiptRows as $receipt) {
                $rNo    = $receipt['receipt_number'];
                $amount = (float)($receipt['total_amount'] ?? 0);
                $cc     = $clientCode ?: ($receipt['ssms_client_code'] ?? '');

                $db->execute(
                    "UPDATE ssms_fee_paid_details
                     SET admin_review = 'Complete', admin_user = ?, admin_review_date = ?
                     WHERE receipt_number = ? AND admin_review IN ('Pending','Under Review')",
                    [$userName, $today, $rNo]
                );

                $runningBalance += $amount;
                $db->execute(
                    "INSERT INTO ssms_balancesheet (trxn_date, trxn_desc, amount, trxn_type, balance, created, modified, ssms_client_code)
                     VALUES (?, ?, ?, 'income', ?, ?, ?, ?)",
                    [$todayDate, "From fee receipt #{$rNo}", round($amount, 2), round($runningBalance, 2), $today, $today, $cc]
                );
                $approved++;
            }
            $db->commit();
            if ($isJson) {
                $this->response = $this->response->withType('application/json')
                    ->withStringBody(json_encode(['status' => true, 'message' => "{$approved} receipt(s) approved and posted to balance sheet."]));
                return $this->response;
            }
            $this->Flash->success("{$approved} receipt(s) approved and posted to balance sheet.");
        } catch (\Exception $e) {
            $db->rollback();
            Log::error('approveCollection error: ' . $e->getMessage());
            if ($isJson) {
                $this->response = $this->response->withType('application/json')
                    ->withStringBody(json_encode(['status' => false, 'message' => $e->getMessage()]));
                return $this->response;
            }
            $this->Flash->error('Approval failed: ' . $e->getMessage());
        }

        return $this->redirect(['action' => 'feeCollectionReport']);
    }

    // =========================================================================
    // FEE ITEMS — master list CRUD
    // =========================================================================

    public function feeItems()
    {
        $clientCode = $this->_clientCode();
        $db         = ConnectionManager::get('default');

        // Save new / edit
        if ($this->request->is('post')) {
            $d = $this->request->getData();

            if (!empty($d['fee_item_id'])) {
                // Update
                $db->execute(
                    "UPDATE ssms_fee_items
                     SET fee_item_name=?, fee_code=?, fee_type=?, category=?, is_mandatory=?, status=?, modified=NOW()
                     WHERE fee_item_id=? AND ssms_client_code=?",
                    [$d['fee_item_name'], $d['fee_code'], $d['fee_type'], $d['category'], $d['is_mandatory'] ?? 'Yes', $d['status'] ?? 'Active', (int)$d['fee_item_id'], $clientCode]
                );
                $this->Flash->success('Fee item updated.');
            } else {
                // Insert
                $db->execute(
                    "INSERT INTO ssms_fee_items (fee_item_name, fee_code, fee_type, category, is_mandatory, status, ssms_client_code, created, modified)
                     VALUES (?,?,?,?,?,?,?,NOW(),NOW())",
                    [$d['fee_item_name'], $d['fee_code'], $d['fee_type'], $d['category'], $d['is_mandatory'] ?? 'Yes', $d['status'] ?? 'Active', $clientCode]
                );
                $this->Flash->success('Fee item created.');
            }
            return $this->redirect(['action' => 'feeItems']);
        }

        // Delete
        if ($this->request->is('delete') || !empty($this->request->getQuery('delete_id'))) {
            $delId = $this->request->getQuery('delete_id');
            if (!empty($delId)) {
                // Check if in use
                $inUse = $db->execute(
                    "SELECT COUNT(*) AS cnt FROM ssms_fee_structure WHERE fee_item_id=? AND ssms_client_code=?",
                    [(int)$delId, $clientCode]
                )->fetchAssoc();
                if ((int)($inUse['cnt'] ?? 0) > 0) {
                    $this->Flash->error('Cannot delete — fee item is in use in fee structure.');
                } else {
                    $db->execute("DELETE FROM ssms_fee_items WHERE fee_item_id=? AND ssms_client_code=?", [(int)$delId, $clientCode]);
                    $this->Flash->success('Fee item deleted.');
                }
            }
            return $this->redirect(['action' => 'feeItems']);
        }

        $feeItemList = $db->execute(
            "SELECT fee_item_id, fee_item_name, fee_code, fee_type, category, is_mandatory, status
             FROM   ssms_fee_items
             WHERE  ssms_client_code = :cc
             ORDER BY fee_item_name ASC",
            ['cc' => $clientCode]
        )->fetchAll('assoc');

        $editItem = null;
        $editId   = $this->request->getQuery('edit_id');
        if (!empty($editId)) {
            foreach ($feeItemList as $fi) {
                if ((string)$fi['fee_item_id'] === (string)$editId) { $editItem = $fi; break; }
            }
        }

        $this->set(compact('feeItemList', 'editItem'));
    }

    // =========================================================================
    // CLASS FEE STRUCTURE — manage fee amounts by class/session/branch
    // =========================================================================

    public function classFeeStructure()
    {
        $clientCode = $this->_clientCode();
        $db         = ConnectionManager::get('default');

        $ssmsClasses    = $db->execute("SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code=:cc ORDER BY class_name", ['cc' => $clientCode])->fetchAll('assoc');
        $ssmsSessions   = $db->execute("SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code=:cc ORDER BY session_id DESC", ['cc' => $clientCode])->fetchAll('assoc');
        $ssmsBranchList = $db->execute("SELECT branch_id, branch_name FROM ssms_branch WHERE ssms_client_code=:cc ORDER BY branch_name", ['cc' => $clientCode])->fetchAll('assoc');
        $feeItemList    = $db->execute("SELECT fee_item_id, fee_item_name, fee_type, is_mandatory FROM ssms_fee_items WHERE ssms_client_code=:cc AND status='Active' ORDER BY fee_item_name", ['cc' => $clientCode])->fetchAll('assoc');

        $feeStructure = [];
        $classId = $sessionId = $branchId = null;

        if ($this->request->is('post')) {
            $d         = $this->request->getData();
            $classId   = $d['class_id']   ?? null;
            $sessionId = $d['session_id'] ?? null;
            $branchId  = $d['branch_id']  ?? null;

            // Save structure
            if (isset($d['save_structure']) && !empty($classId) && !empty($sessionId) && !empty($branchId)) {
                $amounts = $d['amounts'] ?? [];   // [fee_item_id][month_no] => amount or [fee_item_id] => amount for one-time
                $now     = date('Y-m-d H:i:s');

                foreach ($feeItemList as $fi) {
                    $fid = $fi['fee_item_id'];
                    if ($fi['fee_type'] === 'Monthly') {
                        $months = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];
                        foreach ($months as $m) {
                            $amount = (float)($amounts[$fid][$m] ?? 0);
                            if ($amount <= 0) continue;
                            $dueDate = $this->_monthToDate($m);
                            $db->execute(
                                "INSERT INTO ssms_fee_structure (fee_item_id, fee_amount, due_date, class_id, session_id, branch_id, month_no, ssms_client_code, status, created, modified)
                                 VALUES (?,?,?,?,?,?,?,?,'Active',?,?)
                                 ON DUPLICATE KEY UPDATE fee_amount=VALUES(fee_amount), modified=VALUES(modified)",
                                [$fid, $amount, $dueDate, $classId, $sessionId, $branchId, $m, $clientCode, $now, $now]
                            );
                        }
                    } else {
                        $amount = (float)($amounts[$fid] ?? 0);
                        if ($amount <= 0) continue;
                        $db->execute(
                            "INSERT INTO ssms_fee_structure (fee_item_id, fee_amount, due_date, class_id, session_id, branch_id, month_no, ssms_client_code, status, created, modified)
                             VALUES (?,?,CURDATE(),?,?,?,'Apr',?,'Active',?,?)
                             ON DUPLICATE KEY UPDATE fee_amount=VALUES(fee_amount), modified=VALUES(modified)",
                            [$fid, $amount, $classId, $sessionId, $branchId, $clientCode, $now, $now]
                        );
                    }
                }
                $this->Flash->success('Fee structure saved.');
            }

            // Load structure
            if (!empty($classId) && !empty($sessionId) && !empty($branchId)) {
                $rows = $db->execute(
                    "SELECT fs.fee_id, fs.fee_item_id, fs.fee_amount, fs.month_no, fs.due_date
                     FROM   ssms_fee_structure fs
                     WHERE  fs.class_id=:cls AND fs.session_id=:sid AND fs.branch_id=:bid AND fs.ssms_client_code=:cc
                     ORDER BY fs.fee_item_id, fs.month_no",
                    ['cls' => (int)$classId, 'sid' => (int)$sessionId, 'bid' => (int)$branchId, 'cc' => $clientCode]
                )->fetchAll('assoc');

                // Index by fee_item_id and month
                foreach ($rows as $r) {
                    $feeStructure[$r['fee_item_id']][$r['month_no']] = $r['fee_amount'];
                }
            }
        }

        $this->set(compact('ssmsClasses', 'ssmsSessions', 'ssmsBranchList', 'feeItemList',
            'feeStructure', 'classId', 'sessionId', 'branchId'));
    }

    // =========================================================================
    // DEMAND SLIP — class-wise fee demand slip (port of getDemandSlip)
    // =========================================================================

    public function feeDemandSlip()
    {
        $clientCode = $this->_clientCode();
        $db         = ConnectionManager::get('default');
        $today      = date('Y-m-d');

        $ssmsClasses    = $db->execute("SELECT class_id, class_name FROM ssms_classes WHERE ssms_client_code=:cc ORDER BY class_name", ['cc' => $clientCode])->fetchAll('assoc');
        $ssmsSessions   = $db->execute("SELECT session_id, session_name FROM ssms_sessions WHERE ssms_client_code=:cc ORDER BY session_id DESC", ['cc' => $clientCode])->fetchAll('assoc');
        $ssmsBranchList = $db->execute("SELECT branch_id, branch_name FROM ssms_branch WHERE ssms_client_code=:cc ORDER BY branch_name", ['cc' => $clientCode])->fetchAll('assoc');

        $feeCategories = [
            'ALL' => ['label' => 'All Categories', 'category' => null,        'enrTable' => null],
            'SCH' => ['label' => 'Academic',       'category' => 'Academic',  'enrTable' => 'ssms_student_enrollment'],
            'HTL' => ['label' => 'Hostel',         'category' => 'Hostel',    'enrTable' => 'ssms_hostel_enrollment'],
            'TRP' => ['label' => 'Transport',      'category' => 'Transport', 'enrTable' => 'ssms_transport_enrollments'],
        ];

        // Per-category enrollment SQL fragments (each table has a different schema)
        // TRP: enrollment_id is FK to ssms_student_enrollment — must bridge through it for registration_id/section_id
        // HTL: has registration_id + section_id directly, but needs current_status filter
        // SCH: standard ssms_student_enrollment
        $enrollSqlMap = [
            'SCH' => [
                'from'   => 'ssms_student_enrollment e',
                'join'   => 'INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id',
                'select' => 'e.enrollment_id, e.registration_id, COALESCE(e.section_id, NULL) AS section_id',
                'where'  => 'e.class_id = :cls AND e.session_id = :sid AND e.ssms_client_code = :cc',
                'branch' => 'e.branch_id = :bid',
            ],
            'HTL' => [
                'from'   => 'ssms_hostel_enrollment e',
                'join'   => 'INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id',
                'select' => 'e.enrollment_id, e.registration_id, COALESCE(e.section_id, NULL) AS section_id',
                'where'  => 'e.class_id = :cls AND e.session_id = :sid AND e.ssms_client_code = :cc AND e.current_status = \'active\'',
                'branch' => 'e.branch_id = :bid',
            ],
            'TRP' => [
                'from'   => 'ssms_transport_enrollments te',
                'join'   => 'INNER JOIN ssms_student_enrollment e ON e.enrollment_id = te.enrollment_id
                             INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id',
                'select' => 'te.enrollment_id, e.registration_id, COALESCE(e.section_id, NULL) AS section_id',
                'where'  => 'te.class_id = :cls AND te.session_id = :sid AND te.ssms_client_code = :cc',
                'branch' => 'te.branch_id = :bid',
            ],
        ];

        $students  = [];
        $summary   = null;
        $hasLoaded = false;
        $classId = $sessionId = $branchId = null;
        $feeFor  = 'ALL';

        // Accept both POST (filter form) and GET (deep-link from paymentDueByClass)
        if ($this->request->is('post') || !empty($this->request->getQueryParams())) {
            $d         = $this->request->is('post') ? $this->request->getData() : $this->request->getQueryParams();
            $classId   = $d['class_id']   ?? null;
            $sessionId = $d['session_id'] ?? null;
            $branchId  = $d['branch_id']  ?? null;
            $feeFor    = in_array($d['fee_for'] ?? '', ['ALL','SCH','HTL','TRP'], true) ? $d['fee_for'] : 'ALL';

            $runCategories = $feeFor === 'ALL' ? ['SCH','HTL','TRP'] : [$feeFor];

            if (!empty($classId) && !empty($sessionId)) {
                $grandFee = $grandTax = $grandPaid = $grandDue = 0.0;

                foreach ($runCategories as $catKey) {
                    $catMap   = $feeCategories[$catKey];
                    $category = $catMap['category'];
                    $enrTable = $catMap['enrTable'];
                    $catLabel = $catMap['label'];

                    // ── Enrolled students for this category (schema differs per table) ──
                    $esm          = $enrollSqlMap[$catKey];
                    $enrollSql    = "SELECT {$esm['select']},
                               TRIM(CONCAT_WS(' ', r.student_first_name, r.student_last_name)) AS student_name,
                               r.email_address, r.mobile_number
                        FROM   {$esm['from']}
                        {$esm['join']}
                        WHERE  {$esm['where']}";
                    $enrollParams = ['cls' => (int)$classId, 'sid' => (int)$sessionId, 'cc' => $clientCode];
                    if (!empty($branchId)) { $enrollSql .= " AND {$esm['branch']}"; $enrollParams['bid'] = (int)$branchId; }
                    $enrollSql .= " ORDER BY r.student_first_name";
                    $rawStudents = $db->execute($enrollSql, $enrollParams)->fetchAll('assoc');

                    if (empty($rawStudents)) continue;

                    // ── Fee structure filtered by category (deduplicated) ─────
                    // Duplicate ssms_fee_structure rows (same fee_item_id+month_no)
                    // can exist from old buggy saves. Use MIN(fee_id) per combination
                    // so each month shows exactly one row — the canonical original row,
                    // which is also what _saveFeeStructure updates.
                    $feeStructSql = "
                        SELECT fs.fee_id, fs.fee_item_id,
                               COALESCE(fi.fee_item_name,'') AS fee_item_name,
                               fs.fee_amount, fs.due_date, fs.month_no,
                               COALESCE(fi.tax_percent, 0)   AS tax_percent
                        FROM   ssms_fee_structure fs
                        INNER JOIN ssms_fee_items fi
                            ON  fi.fee_item_id = fs.fee_item_id
                            AND fi.category    = :cat
                        WHERE  fs.class_id=:cls AND fs.session_id=:sid
                          AND  fs.due_date < :td AND fs.ssms_client_code=:cc
                          AND  fs.fee_id = (
                              SELECT MIN(fs2.fee_id)
                              FROM   ssms_fee_structure fs2
                              WHERE  fs2.fee_item_id     = fs.fee_item_id
                                AND  fs2.month_no        = fs.month_no
                                AND  fs2.class_id        = fs.class_id
                                AND  fs2.session_id      = fs.session_id
                                AND  fs2.ssms_client_code = fs.ssms_client_code
                          )
                    ";
                    $feeStructParams = [
                        'cat' => $category, 'cls' => (int)$classId,
                        'sid' => (int)$sessionId, 'td' => $today, 'cc' => $clientCode,
                    ];
                    if (!empty($branchId)) { $feeStructSql .= " AND fs.branch_id=:bid"; $feeStructParams['bid'] = (int)$branchId; }
                    $feeStructSql .= " ORDER BY fs.due_date, fs.fee_item_id";
                    $feeStructure = $db->execute($feeStructSql, $feeStructParams)->fetchAll('assoc');

                    if (empty($feeStructure)) continue;

                    // ── Payments + discounts for these students ────────────────
                    $enrollIds = array_column($rawStudents, 'enrollment_id');
                    $ph        = implode(',', array_fill(0, count($enrollIds), '?'));

                    $payments = $db->execute(
                        "SELECT enrollment_id, fee_id,
                                SUM(paid_amount - COALESCE(late_fee, 0)) AS total_paid_net,
                                SUM(late_fee)                             AS total_late
                         FROM   ssms_fee_paid_details
                         WHERE  enrollment_id IN ({$ph}) AND session_id=? AND paid_amount>0
                         GROUP BY enrollment_id, fee_id",
                        array_merge(array_values($enrollIds), [(int)$sessionId])
                    )->fetchAll('assoc');
                    $payIdx = [];
                    foreach ($payments as $p) {
                        // Key by fee_id (unique per structure row/month) so that different
                        // months of the same fee_item_id never overwrite each other.
                        $payIdx[$p['enrollment_id']][$p['fee_id']] = $p;
                    }

                    // Fetch ALL discounts for these students in this session (no fee_item_id filter).
                    // Discounts are typically stored only for Academic fee items, but the percent
                    // should apply across all categories (Hostel, Transport too).
                    $discounts = $db->execute(
                        "SELECT enrollment_id, fee_item_id,
                                COALESCE(discount_percent, 0) AS discount_percent,
                                COALESCE(discount_amount,  0) AS discount_amount,
                                COALESCE(reason, '')          AS discount_reason
                         FROM   ssms_student_discounts
                         WHERE  enrollment_id IN ({$ph}) AND session_id=?",
                        array_merge(array_values($enrollIds), [(int)$sessionId])
                    )->fetchAll('assoc');

                    // Index by enrollment_id → fee_item_id for exact lookup.
                    // Discounts only apply where explicitly configured per fee item.
                    $discIdx = [];
                    foreach ($discounts as $disc) {
                        $discIdx[$disc['enrollment_id']][$disc['fee_item_id']] = $disc;
                    }

                    // ── Build per-student data ────────────────────────────────
                    foreach ($rawStudents as $stu) {
                        $eid      = $stu['enrollment_id'];
                        $stuFee   = $stuTax = $stuPaid = $stuDue = 0.0;
                        $feeItems = [];

                        foreach ($feeStructure as $fs) {
                            $feeAmt     = (float)$fs['fee_amount'];
                            $taxPct     = (float)$fs['tax_percent'];
                            // Look up by fee_id (unique per month/row) so months of the
                            // same fee_item_id are never conflated with each other.
                            $paid       = (float)($payIdx[$eid][$fs['fee_id']]['total_paid_net'] ?? 0);
                            $late       = (float)($payIdx[$eid][$fs['fee_id']]['total_late']     ?? 0);
                            // Discount only applies if explicitly configured for this fee item.
                            $discRow    = $discIdx[$eid][$fs['fee_item_id']] ?? null;
                            $discPct    = (float)($discRow['discount_percent'] ?? 0);
                            // Always derive discAmt from percent when percent>0 — the stored
                            // discount_amount may be 0 if fee structure didn't exist at save time.
                            $discAmt    = $discPct > 0
                                ? round($feeAmt * $discPct / 100, 2)
                                : (float)($discRow['discount_amount'] ?? 0);
                            $discReason = $discRow['discount_reason'] ?? '';

                            // paid_amount in the DB includes the tax portion, so balance_due
                            // must also include tax — compare like-for-like.
                            $taxAmt        = round(($feeAmt - $discAmt) * $taxPct / 100, 2);
                            $netFee        = round($feeAmt - $discAmt, 2);              // excl. tax
                            $netFeeWithTax = round($netFee + $taxAmt, 2);              // total student owes
                            $balance       = round(max(0, $netFeeWithTax - $paid), 2); // total outstanding

                            $stuFee  += $netFee;
                            $stuTax  += $taxAmt;
                            $stuPaid += $paid;
                            $stuDue  += $balance;

                            $feeItems[] = [
                                'fee_item_name'    => $fs['fee_item_name'],
                                'month_no'         => $fs['month_no'],
                                'due_date'         => $fs['due_date'],
                                'fee_amount'       => round($feeAmt, 2),
                                'discount_amount'  => round($discAmt, 2),
                                'discount_percent' => round($discPct, 2),
                                'discount_reason'  => $discReason,
                                'tax_percent'      => round($taxPct, 2),
                                'tax_amount'       => $taxAmt,
                                'net_fee_amount'   => $netFeeWithTax, // total incl. tax
                                'previously_paid'  => round($paid, 2),
                                'late_fee'         => round($late, 2),
                                'balance_due'      => $balance,       // total outstanding incl. tax
                            ];
                        }

                        $grandFee  += $stuFee;
                        $grandTax  += $stuTax;
                        $grandPaid += $stuPaid;
                        $grandDue  += $stuDue;

                        $students[] = [
                            'enrollment_id'   => $eid,
                            'registration_id' => $stu['registration_id'],
                            'section_id'      => $stu['section_id'] ?? null,
                            'category'        => $catLabel,
                            'student_name'    => $stu['student_name'],
                            'email_address'   => $stu['email_address'],
                            'mobile_number'   => $stu['mobile_number'],
                            'total_fee'       => round($stuFee, 2),   // excl. tax
                            'total_tax'       => round($stuTax, 2),   // tax only
                            'total_paid'      => round($stuPaid, 2),
                            'total_due'       => round($stuDue, 2),   // excl. tax
                            'fee_items'       => $feeItems,
                        ];
                    }
                }

                // ── Merge multi-category entries for the same student ─────────
                // A student enrolled in SCH + HTL + TRP would appear 3× in $students.
                // Collapse them into one entry per enrollment_id so each student
                // gets a single combined demand letter.
                $merged = [];
                foreach ($students as $s) {
                    $key = $s['enrollment_id'];
                    if (!isset($merged[$key])) {
                        $merged[$key] = $s;
                    } else {
                        // Append fee items from additional categories
                        $merged[$key]['fee_items']   = array_merge($merged[$key]['fee_items'], $s['fee_items']);
                        $merged[$key]['total_fee']  += $s['total_fee'];
                        $merged[$key]['total_tax']  += $s['total_tax'];
                        $merged[$key]['total_paid'] += $s['total_paid'];
                        $merged[$key]['total_due']  += $s['total_due'];
                        // Combine category labels (e.g. "Academic / Hostel")
                        if (strpos($merged[$key]['category'], $s['category']) === false) {
                            $merged[$key]['category'] .= ' / ' . $s['category'];
                        }
                    }
                }
                $students = array_values($merged);

                // Round merged totals
                foreach ($students as &$s) {
                    $s['total_fee']  = round($s['total_fee'],  2);
                    $s['total_tax']  = round($s['total_tax'],  2);
                    $s['total_paid'] = round($s['total_paid'], 2);
                    $s['total_due']  = round($s['total_due'],  2);
                }
                unset($s);

                // Sort merged results by student name
                usort($students, fn($a, $b) => strcmp($a['student_name'], $b['student_name']));

                $summary   = [
                    'student_count' => count($students),
                    'total_fee'     => round($grandFee,  2),   // excl. tax
                    'total_tax'     => round($grandTax,  2),   // tax only
                    'total_paid'    => round($grandPaid, 2),
                    'total_due'     => round($grandDue,  2),   // excl. tax
                ];
                $hasLoaded = true;
            }
        }

        $ci = $this->_clientInfo();
        $this->set(compact(
            'ssmsClasses', 'ssmsSessions', 'ssmsBranchList', 'feeCategories',
            'students', 'summary', 'hasLoaded',
            'classId', 'sessionId', 'branchId', 'feeFor', 'ci'
        ));
    }

    // =========================================================================
    // STUDENT DISCOUNTS — per-fee-item discounts for a student
    // =========================================================================

    public function studentDiscounts($enrollmentId = null)
    {
        $clientCode = $this->_clientCode();
        $db         = ConnectionManager::get('default');

        // Student info
        $student = $db->execute("
            SELECT e.enrollment_id, e.session_id, e.class_id, e.branch_id,
                   TRIM(CONCAT_WS(' ', r.student_first_name, r.student_last_name)) AS student_name,
                   COALESCE(ss.session_name,'') AS session_name,
                   COALESCE(sc.class_name,'')   AS class_name
            FROM   ssms_student_enrollment e
            INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id
            LEFT  JOIN ssms_sessions ss ON ss.session_id = e.session_id
            LEFT  JOIN ssms_classes  sc ON sc.class_id   = e.class_id
            WHERE  e.enrollment_id = :eid AND e.ssms_client_code = :cc LIMIT 1
        ", ['eid' => (int)$enrollmentId, 'cc' => $clientCode])->fetchAssoc();

        if (empty($student)) {
            $this->Flash->error('Student enrollment not found.');
            return $this->redirect(['action' => 'paymentDueList']);
        }

        $sessionId = $student['session_id'];
        $classId   = $student['class_id'];
        $branchId  = $student['branch_id'];

        // Save discounts
        if ($this->request->is('post')) {
            $items = $this->request->getData('items') ?? [];
            $now   = date('Y-m-d H:i:s');
            foreach ($items as $item) {
                $feeItemId = (int)($item['fee_item_id'] ?? 0);
                $percent   = min(100, max(0, (float)($item['discount_percent'] ?? 0)));
                $reason    = trim((string)($item['reason'] ?? ''));
                if (!$feeItemId) continue;

                $feeRow = $db->execute(
                    "SELECT fee_amount FROM ssms_fee_structure WHERE fee_item_id=? AND session_id=? AND ssms_client_code=? LIMIT 1",
                    [$feeItemId, $sessionId, $clientCode]
                )->fetchAssoc();
                $feeAmount      = (float)($feeRow['fee_amount'] ?? 0);
                $discountAmount = round($feeAmount * $percent / 100, 2);

                $db->execute(
                    "INSERT INTO ssms_student_discounts
                        (enrollment_id, fee_item_id, session_id, class_id, branch_id, discount_percent,
                         discount_amount, reason, ssms_client_code, created_by, created, modified)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                     ON DUPLICATE KEY UPDATE
                        discount_percent=VALUES(discount_percent), discount_amount=VALUES(discount_amount),
                        reason=VALUES(reason), modified=VALUES(modified)",
                    [(int)$enrollmentId, $feeItemId, $sessionId, $classId, $branchId,
                     $percent, $discountAmount, $reason, $clientCode, $this->_userName(), $now, $now]
                );
            }
            $this->Flash->success('Discounts saved.');
        }

        // Fee items for this student's class/session
        $feeItemsForDiscount = $db->execute("
            SELECT fi.fee_item_id, fi.fee_item_name, fi.fee_type, fs.fee_amount,
                   COALESCE(sd.discount_percent, 0) AS discount_percent,
                   COALESCE(sd.discount_amount,  0) AS discount_amount,
                   COALESCE(sd.reason, '')           AS reason,
                   sd.discount_id
            FROM   ssms_fee_structure fs
            LEFT JOIN ssms_fee_items fi ON fi.fee_item_id = fs.fee_item_id
            LEFT JOIN ssms_student_discounts sd
                ON  sd.enrollment_id = :eid AND sd.fee_item_id = fi.fee_item_id
                AND sd.session_id = fs.session_id AND sd.ssms_client_code = fs.ssms_client_code
            WHERE  fs.class_id   = :cls AND fs.session_id = :sid AND fs.ssms_client_code = :cc
            GROUP BY fi.fee_item_id, fi.fee_item_name, fi.fee_type, fs.fee_amount,
                     sd.discount_percent, sd.discount_amount, sd.reason, sd.discount_id
            ORDER BY fi.fee_item_name
        ", ['eid' => (int)$enrollmentId, 'cls' => (int)$classId, 'sid' => (int)$sessionId, 'cc' => $clientCode])
        ->fetchAll('assoc');

        $this->set(compact('student', 'feeItemsForDiscount', 'enrollmentId'));
    }

    

    // =========================================================================
    // Private utilities
    // =========================================================================

    /** Month abbreviation → Y-m-01 due date */
    private function _monthToDate(string $month): string
    {
        $year = (int)date('Y');
        $map  = ['Apr'=>'04','May'=>'05','Jun'=>'06','Jul'=>'07','Aug'=>'08','Sep'=>'09',
                 'Oct'=>'10','Nov'=>'11','Dec'=>'12','Jan'=>'01','Feb'=>'02','Mar'=>'03'];
        $mo   = $map[$month] ?? '04';
        $y    = in_array($month, ['Jan','Feb','Mar']) ? $year + 1 : $year;
        return sprintf('%04d-%s-01', $y, $mo);
    }

    /** Simple XOR decrypt for re-enroll param (mirrors ssmslibs/functions.php) */
    private function _decrypt(string $encoded): string
    {
        try {
            return urldecode(base64_decode(strrev($encoded)));
        } catch (\Throwable) {
            return '';
        }
    }

    // =========================================================================
    // ONLINE PAYMENT — PhonePe Standard Checkout (PG API)
    // =========================================================================

    /**
     * Step 1 — Initiate payment
     * POST /ssms-fee-paid-details/initiate-online-payment
     * Body (JSON): { enrollment_id, fee_for, selected_fee_items[], amount }
     * Returns JSON: { success, order_id, redirect_url } or { success:false, message }
     */
    public function initiateOnlinePayment(): void
    {
        $this->request->allowMethod(['post']);
        $this->autoRender = false;

        $clientCode = $this->_clientCode();
        $userName   = $this->_userName();
        $db         = ConnectionManager::get('default');

        // Parse JSON body
        $body          = json_decode((string)$this->request->getBody(), true) ?? [];
        $enrollmentId  = (int)($body['enrollment_id'] ?? 0);
        $feeFor        = strtoupper(trim((string)($body['fee_for']  ?? 'SCH')));
        $feeItems      = $body['selected_fee_items'] ?? [];
        $amount        = round((float)($body['amount'] ?? 0), 2);
        // 'redirect' = PhonePe PG hosted page | 'qr' = UPI QR (Google Pay / Paytm)
        $mode          = strtolower(trim((string)($body['mode']           ?? 'redirect')));
        $paymentMethod = trim((string)($body['payment_method'] ?? 'PhonePe'));

        if ($enrollmentId <= 0 || empty($feeItems) || $amount <= 0) {
            $this->_jsonResponse(['success' => false, 'message' => 'Invalid request parameters.'], 422);
            return;
        }

        // Load per-client PhonePe credentials from ssms_clients
        $ci         = $this->_clientInfo();
        $merchantId = $ci['phonepe_merchant_id'];
        $saltKey    = $ci['phonepe_salt_key'];
        $saltIndex  = (int)($ci['phonepe_salt_index'] ?? 1);
        $ppEnv      = strtolower((string)($ci['phonepe_env'] ?? 'sandbox'));

        if (empty($merchantId) || empty($saltKey)) {
            $this->_jsonResponse([
                'success' => false,
                'message' => 'Online payment is not configured for this school. Please enter PhonePe credentials in Client Settings.',
            ], 503);
            return;
        }

        $apiBase = ($ppEnv === 'production')
            ? 'https://api.phonepe.com/apis/hermes'
            : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

        // Generate unique order ID
        $orderId   = 'SSMS' . $clientCode . time() . rand(100, 999);
        $amtPaise  = (int)round($amount * 100);

        // Build redirect + callback URLs
        $returnUrl   = rtrim(env('APP_FULL_BASE_URL', 'http://' . $_SERVER['HTTP_HOST']), '/');
        $redirectUrl = $returnUrl . '/ssms-fee-paid-details/payment-return/' . urlencode($orderId);
        $callbackUrl = $returnUrl . '/ssms-fee-paid-details/payment-callback';

        // Payload — UPI_QR for Google Pay / Paytm, PAY_PAGE for PhonePe redirect
        $instrument = ($mode === 'qr') ? ['type' => 'UPI_QR'] : ['type' => 'PAY_PAGE'];
        $payload = [
            'merchantId'            => $merchantId,
            'merchantTransactionId' => $orderId,
            'amount'                => $amtPaise,
            'redirectUrl'           => $redirectUrl,
            'redirectMode'          => 'REDIRECT',
            'callbackUrl'           => $callbackUrl,
            'paymentInstrument'     => $instrument,
        ];

        $base64Payload = base64_encode(json_encode($payload));
        $xVerify       = hash('sha256', $base64Payload . '/pg/v1/pay' . $saltKey) . '###' . $saltIndex;

        // Insert pending order first (so webhook can reference it even before redirect)
        try {
            $db->execute(
                "INSERT INTO ssms_online_orders
                    (order_id, ssms_client_code, enrollment_id, fee_for,
                     fee_items_json, amount_rupees, amount_paise, gateway,
                     status, initiated_by, created_at, updated_at)
                 VALUES (?,?,?,?,?,?,?,'PhonePe','Pending',?,NOW(),NOW())",
                [
                    $orderId, $clientCode, $enrollmentId, $feeFor,
                    json_encode($feeItems), $amount, $amtPaise, $userName,
                ]
            );
        } catch (\Exception $e) {
            Log::error('initiateOnlinePayment DB error: ' . $e->getMessage());
            $this->_jsonResponse(['success' => false, 'message' => 'Could not create order record.'], 500);
            return;
        }

        // Call PhonePe API
        $ch = curl_init($apiBase . '/pg/v1/pay');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode(['request' => $base64Payload]),
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'X-VERIFY: ' . $xVerify,
                'X-MERCHANT-ID: ' . $merchantId,
            ],
            CURLOPT_TIMEOUT        => 30,
        ]);
        $raw      = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        if ($curlErr) {
            $this->_updateOrderStatus($orderId, 'Failed', null, ['curl_error' => $curlErr], $db);
            $this->_jsonResponse(['success' => false, 'message' => 'Could not reach payment gateway. Try again.'], 502);
            return;
        }

        $resp = json_decode($raw, true);
        if (empty($resp['success']) || empty($resp['data']['instrumentResponse']['redirectInfo']['url'])) {
            Log::warning('PhonePe initiate failed: ' . $raw);
            $this->_updateOrderStatus($orderId, 'Failed', null, $resp, $db);
            $this->_jsonResponse([
                'success' => false,
                'message' => $resp['message'] ?? 'Payment gateway error. Please try again.',
            ], 502);
            return;
        }

        if ($mode === 'qr') {
            // ── UPI QR mode (Google Pay / Paytm) ─────────────────────────────
            $qrData = $resp['data']['instrumentResponse']['qrData'] ?? null;
            if (empty($qrData)) {
                Log::warning('PhonePe UPI_QR: no qrData in response: ' . json_encode($resp));
                $this->_updateOrderStatus($orderId, 'Failed', null, $resp, $db);
                $this->_jsonResponse([
                    'success' => false,
                    'message' => $resp['message'] ?? 'Could not generate QR code. Try again.',
                ], 502);
                return;
            }
            // Tag order with actual payment method (GooglePay / Paytm)
            $db->execute(
                "UPDATE ssms_online_orders SET gateway=?, updated_at=NOW() WHERE order_id=?",
                [$paymentMethod, $orderId]
            );
            $this->_jsonResponse([
                'success'  => true,
                'mode'     => 'qr',
                'order_id' => $orderId,
                'qr_data'  => $qrData,  // UPI string — render as QR on frontend
                'amount'   => $amount,
            ]);
        } else {
            // ── Redirect mode (PhonePe PG hosted page) ───────────────────────
            $pgRedirectUrl = $resp['data']['instrumentResponse']['redirectInfo']['url'] ?? null;
            if (empty($pgRedirectUrl)) {
                Log::warning('PhonePe PAY_PAGE: no redirectUrl in response: ' . json_encode($resp));
                $this->_updateOrderStatus($orderId, 'Failed', null, $resp, $db);
                $this->_jsonResponse([
                    'success' => false,
                    'message' => $resp['message'] ?? 'Could not get payment URL. Try again.',
                ], 502);
                return;
            }
            $db->execute(
                "UPDATE ssms_online_orders SET redirect_url=?, updated_at=NOW() WHERE order_id=?",
                [$pgRedirectUrl, $orderId]
            );
            $this->_jsonResponse([
                'success'      => true,
                'mode'         => 'redirect',
                'order_id'     => $orderId,
                'redirect_url' => $pgRedirectUrl,
            ]);
        }
    }

    /**
     * Step 2 — PhonePe webhook callback (server-to-server, no auth)
     * POST /ssms-fee-paid-details/payment-callback
     * PhonePe POSTs a base64-encoded response + X-VERIFY header.
     * Must respond 200 OK — PhonePe retries on non-200.
     */
    public function paymentCallback(): void
    {
        $this->autoRender = false;

        $db = ConnectionManager::get('default');

        // Parse body first so we can extract order ID → look up client's salt key
        $rawBody    = (string)$this->request->getBody();
        $body       = json_decode($rawBody, true) ?? [];
        $base64Resp = $body['response'] ?? '';
        $decoded    = json_decode(base64_decode($base64Resp), true) ?? [];
        $data       = $decoded['data'] ?? [];
        $earlOrder  = $data['merchantTransactionId'] ?? '';

        // Resolve client-specific salt from the order record
        $saltKey   = '';
        $saltIndex = 1;
        if (!empty($earlOrder)) {
            $orderRow = $db->execute(
                "SELECT ssms_client_code FROM ssms_online_orders WHERE order_id=? LIMIT 1",
                [$earlOrder]
            )->fetchAssoc();
            if (!empty($orderRow['ssms_client_code'])) {
                $credRow = $db->execute(
                    "SELECT phonepe_salt_key, phonepe_salt_index FROM ssms_clients
                     WHERE ssms_client_code=? LIMIT 1",
                    [$orderRow['ssms_client_code']]
                )->fetchAssoc();
                $saltKey   = trim((string)($credRow['phonepe_salt_key']   ?? ''));
                $saltIndex = (int)($credRow['phonepe_salt_index']         ?? 1);
            }
        }

        // Verify signature
        $xVerifyHeader = $this->request->getHeaderLine('X-VERIFY');

        if (!empty($saltKey) && !empty($xVerifyHeader)) {
            $expectedVerify = hash('sha256', $base64Resp . $saltKey) . '###' . $saltIndex;
            if (!hash_equals($expectedVerify, $xVerifyHeader)) {
                Log::warning('PhonePe callback: signature mismatch');
                $this->response = $this->response->withStatus(400)
                    ->withStringBody('Signature mismatch');
                return;
            }
        }

        // $decoded and $data already parsed above for credential lookup
        $success = !empty($decoded['success']) && ($decoded['code'] ?? '') === 'PAYMENT_SUCCESS';
        $orderId = $data['merchantTransactionId'] ?? $earlOrder;
        $gwTxnId = $data['transactionId']         ?? null;

        if (empty($orderId)) {
            $this->response = $this->response->withStatus(400)->withStringBody('Missing merchantTransactionId');
            return;
        }

        // Fetch our order
        $order = $db->execute(
            "SELECT * FROM ssms_online_orders WHERE order_id=? LIMIT 1", [$orderId]
        )->fetchAssoc();

        if (empty($order)) {
            Log::warning("PhonePe callback: order not found: $orderId");
            $this->response = $this->response->withStatus(200)->withStringBody('OK');
            return;
        }

        // Idempotency — don't re-process already handled orders
        if ($order['status'] === 'Success') {
            $this->response = $this->response->withStatus(200)->withStringBody('OK');
            return;
        }

        $newStatus = $success ? 'Success' : 'Failed';
        $this->_updateOrderStatus($orderId, $newStatus, $gwTxnId, $decoded, $db);

        if ($success) {
            try {
                $receiptNumber = $this->_createReceiptFromOrder($order, $gwTxnId, $db);
                $db->execute(
                    "UPDATE ssms_online_orders SET receipt_number=?, updated_at=NOW() WHERE order_id=?",
                    [$receiptNumber, $orderId]
                );
            } catch (\Exception $e) {
                // Receipt creation failed — mark order for manual review, don't return error
                // so PhonePe doesn't retry (money already collected)
                Log::error("PhonePe callback receipt creation failed for order $orderId: " . $e->getMessage());
                $db->execute(
                    "UPDATE ssms_online_orders SET status='Success', gateway_response_json=?, updated_at=NOW()
                     WHERE order_id=?",
                    [json_encode(['callback' => $decoded, 'receipt_error' => $e->getMessage()]), $orderId]
                );
            }
        }

        $this->response = $this->response->withStatus(200)->withStringBody('OK');
    }

    /**
     * Step 3 — Return page after PhonePe redirect
     * GET /ssms-fee-paid-details/payment-return/{orderId}
     * Verifies status via PhonePe status API, then renders result page.
     */
    public function paymentReturn(string $orderId = '')
    {
        $orderId    = urldecode($orderId);
        $db         = ConnectionManager::get('default');
        $clientCode = $this->_clientCode();

        $order = $db->execute(
            "SELECT * FROM ssms_online_orders WHERE order_id=? AND ssms_client_code=? LIMIT 1",
            [$orderId, $clientCode]
        )->fetchAssoc();

        if (empty($order)) {
            $this->Flash->error('Order not found.');
            return $this->redirect(['action' => 'index']);
        }

        // If still Pending — poll PhonePe status API
        $status        = $order['status'];
        $receiptNumber = $order['receipt_number'] ?? null;
        $gwTxnId       = $order['gateway_txn_id'] ?? null;
        $errorMessage  = null;

        if ($status === 'Pending') {
            [$status, $gwTxnId, $errorMessage] = $this->_pollPhonePeStatus($orderId, $order, $db);
            $receiptNumber = $db->execute(
                "SELECT receipt_number FROM ssms_online_orders WHERE order_id=? LIMIT 1", [$orderId]
            )->fetchAssoc()['receipt_number'] ?? null;
        }

        // Build enrollment link for "go back"
        $feeFor     = $order['fee_for'] ?? 'SCH';
        $enrollId   = $order['enrollment_id'];
        $backUrl    = $this->Url->build([
            'action'  => 'studentClassFee',
            $enrollId, 0, 0, $feeFor,
        ]);

        $this->viewBuilder()->disableAutoLayout();
        $currency = $this->_clientInfo()['currency'];
        $this->set(compact('order', 'status', 'receiptNumber', 'gwTxnId', 'errorMessage', 'backUrl', 'orderId', 'currency'));
    }

    /**
     * AJAX status check
     * GET /ssms-fee-paid-details/check-payment-status?order_id=SSMS...
     * Returns JSON { status, receipt_number, gateway_txn_id }
     */
    public function checkPaymentStatus(): void
    {
        $this->autoRender = false;
        $orderId    = $this->request->getQuery('order_id') ?? '';
        $clientCode = $this->_clientCode();
        $db         = ConnectionManager::get('default');

        if (empty($orderId)) {
            $this->_jsonResponse(['success' => false, 'message' => 'order_id required.'], 400);
            return;
        }

        $order = $db->execute(
            "SELECT status, receipt_number, gateway_txn_id FROM ssms_online_orders
             WHERE order_id=? AND ssms_client_code=? LIMIT 1",
            [$orderId, $clientCode]
        )->fetchAssoc();

        if (empty($order)) {
            $this->_jsonResponse(['success' => false, 'message' => 'Order not found.'], 404);
            return;
        }

        // If still Pending, do a live check against the appropriate gateway
        if ($order['status'] === 'Pending') {
            $fullOrder = $db->execute(
                "SELECT * FROM ssms_online_orders WHERE order_id=? LIMIT 1", [$orderId]
            )->fetchAssoc();
            $gateway = strtolower(trim((string)($fullOrder['gateway'] ?? 'phonepe')));
            if ($gateway === 'razorpay') {
                [$order['status'], $order['gateway_txn_id']] = $this->_pollRazorpayStatus($orderId, $fullOrder, $db);
            } else {
                [$order['status'], $order['gateway_txn_id']] = $this->_pollPhonePeStatus($orderId, $fullOrder, $db);
            }
            $order['receipt_number'] = $db->execute(
                "SELECT receipt_number FROM ssms_online_orders WHERE order_id=? LIMIT 1", [$orderId]
            )->fetchAssoc()['receipt_number'] ?? null;
        }

        $this->_jsonResponse([
            'success'        => true,
            'status'         => $order['status'],
            'receipt_number' => $order['receipt_number'],
            'gateway_txn_id' => $order['gateway_txn_id'],
        ]);
    }

    // ── PhonePe Helpers ──────────────────────────────────────────────────────────

    /**
     * Poll PhonePe /pg/v1/status API, update DB, create receipt on success.
     * Returns [status, gwTxnId, errorMessage]
     */
    private function _pollPhonePeStatus(string $orderId, array $order, $db): array
    {
        // Load credentials from ssms_clients using the order's client code
        $clientCode = $order['ssms_client_code'] ?? '';
        $credRow    = [];
        if (!empty($clientCode)) {
            $credRow = $db->execute(
                "SELECT phonepe_merchant_id, phonepe_salt_key, phonepe_salt_index, phonepe_env
                 FROM ssms_clients WHERE ssms_client_code=? LIMIT 1",
                [$clientCode]
            )->fetchAssoc() ?: [];
        }
        $merchantId = trim((string)($credRow['phonepe_merchant_id'] ?? ''));
        $saltKey    = trim((string)($credRow['phonepe_salt_key']    ?? ''));
        $saltIndex  = (int)($credRow['phonepe_salt_index']          ?? 1);
        $ppEnv      = strtolower(trim((string)($credRow['phonepe_env'] ?? 'sandbox')));
        $apiBase    = ($ppEnv === 'production')
            ? 'https://api.phonepe.com/apis/hermes'
            : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

        if (empty($merchantId) || empty($saltKey)) {
            return ['Pending', null, 'PhonePe credentials not configured for this school.'];
        }

        $endpoint  = "/pg/v1/status/{$merchantId}/{$orderId}";
        $xVerify   = hash('sha256', $endpoint . $saltKey) . '###' . $saltIndex;

        $ch = curl_init($apiBase . $endpoint);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'X-VERIFY: ' . $xVerify,
                'X-MERCHANT-ID: ' . $merchantId,
            ],
            CURLOPT_TIMEOUT => 20,
        ]);
        $raw     = curl_exec($ch);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if ($curlErr) {
            Log::warning("PhonePe status check curl error for $orderId: $curlErr");
            return ['Pending', null, 'Gateway timeout. Please wait and refresh.'];
        }

        $resp    = json_decode($raw, true) ?? [];
        $success = !empty($resp['success']) && ($resp['code'] ?? '') === 'PAYMENT_SUCCESS';
        $data    = $resp['data'] ?? [];
        $gwTxnId = $data['transactionId'] ?? null;
        $newStatus = $success ? 'Success' : (
            in_array($resp['code'] ?? '', ['PAYMENT_PENDING', 'AUTHORIZATION_FAILED']) ? 'Pending' : 'Failed'
        );
        $errMsg = $success ? null : ($resp['message'] ?? 'Payment was not successful.');

        $this->_updateOrderStatus($orderId, $newStatus, $gwTxnId, $resp, $db);

        if ($success && ($order['status'] ?? '') !== 'Success') {
            try {
                $receiptNumber = $this->_createReceiptFromOrder($order, $gwTxnId, $db);
                $db->execute(
                    "UPDATE ssms_online_orders SET receipt_number=?, updated_at=NOW() WHERE order_id=?",
                    [$receiptNumber, $orderId]
                );
            } catch (\Exception $e) {
                Log::error("_pollPhonePeStatus receipt creation error for $orderId: " . $e->getMessage());
                $errMsg = 'Payment received but receipt creation failed. Contact admin.';
            }
        }

        return [$newStatus, $gwTxnId, $errMsg];
    }

    /**
     * Create fee paid detail rows from an online order (mirrors collectFee logic).
     * Sets admin_review = 'Complete' automatically (payment confirmed by gateway).
     * Returns generated receipt number.
     */
    private function _createReceiptFromOrder(array $order, ?string $gwTxnId, $db): string
    {
        $clientCode   = $order['ssms_client_code'];
        $enrollmentId = $order['enrollment_id'];
        $feeItems     = json_decode($order['fee_items_json'], true) ?? [];
        $amountRupees = (float)$order['amount_rupees'];
        $paymentDate  = date('Y-m-d');
        $now          = date('Y-m-d H:i:s');
        $initiatedBy  = $order['initiated_by'] ?? 'system';
        $paymentMethod = 'PhonePe';

        // Generate receipt number: ONLINE-{clientCode}-{timestamp}
        $receiptNumber = 'ONL-' . strtoupper($clientCode) . '-' . date('YmdHis');

        $remaining = $amountRupees;

        $db->begin();
        try {
            foreach ($feeItems as $item) {
                if ($remaining <= 0) break;

                $sessionId      = !empty($item['session_id'])      ? (int)$item['session_id']      : null;
                $classId        = !empty($item['class_id'])        ? (int)$item['class_id']        : null;
                $branchId       = !empty($item['branch_id'])       ? (int)$item['branch_id']       : null;
                $registrationId = !empty($item['registration_id']) ? (int)$item['registration_id'] : null;
                $lateFee        = round((float)($item['late_fee']         ?? 0), 2);
                $discountPct    = round((float)($item['discount_percent'] ?? 0), 2);
                $discountAmt    = round((float)($item['discount_amount']  ?? 0), 2);
                $discountReason = trim((string)($item['discount_reason']  ?? ''));
                $taxPct         = round((float)($item['tax_percent']      ?? 0), 2);
                $taxAmt         = round((float)($item['tax_amount']       ?? 0), 2);
                $balanceDue     = round((float)($item['balance_due']      ?? $item['fee_amount'] ?? 0), 2);

                $allocate  = round(min($remaining, $balanceDue + $lateFee), 2);
                $remaining = round($remaining - $allocate, 2);

                $db->execute(
                    'INSERT INTO ssms_fee_paid_details
                        (enrollment_id, registration_id, fee_id, fee_item_id,
                         session_id, class_id, branch_id, ssms_client_code,
                         receipt_number, paid_amount, fee_paid_amount, late_fee,
                         discount_percent, discount_amount, discount_reason,
                         tax_percent, tax_amount,
                         payment_date, payment_method, admin_review, admin_user,
                         ssms_user_name, enrolled, created, modified)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    [
                        $enrollmentId,
                        $registrationId,
                        (int)($item['fee_id']      ?? 0),
                        (int)($item['fee_item_id'] ?? 0),
                        $sessionId, $classId, $branchId, $clientCode,
                        $receiptNumber,
                        $allocate,
                        round($allocate - $lateFee, 2),
                        $lateFee,
                        $discountPct, $discountAmt, $discountReason,
                        $taxPct, $taxAmt,
                        $paymentDate,
                        $paymentMethod,
                        'Complete',      // auto-approved — gateway confirmed payment
                        $initiatedBy,
                        $initiatedBy,
                        1,
                        $now, $now,
                    ]
                );

                // Post to balance sheet
                $balRow = $db->execute(
                    "SELECT COALESCE(balance,0) AS balance FROM ssms_balancesheet
                     WHERE ssms_client_code=? ORDER BY id DESC LIMIT 1",
                    [$clientCode]
                )->fetchAssoc();
                $newBalance = (float)($balRow['balance'] ?? 0) + $allocate;
                $db->execute(
                    "INSERT INTO ssms_balancesheet
                        (trxn_date, trxn_desc, amount, trxn_type, balance, created, modified, ssms_client_code)
                     VALUES (?,?,?,'income',?,?,?,?)",
                    [
                        $paymentDate,
                        "Online fee receipt #{$receiptNumber}" . ($gwTxnId ? " [PhonePe: $gwTxnId]" : ''),
                        round($allocate, 2),
                        round($newBalance, 2),
                        $now, $now, $clientCode,
                    ]
                );
            }
            $db->commit();
        } catch (\Exception $e) {
            $db->rollback();
            throw $e;
        }

        return $receiptNumber;
    }

    /** Update order status and optionally store raw gateway response */
    private function _updateOrderStatus(string $orderId, string $status, ?string $gwTxnId, ?array $responseData, $db): void
    {
        $db->execute(
            "UPDATE ssms_online_orders
             SET status=?, gateway_txn_id=?, gateway_response_json=?, updated_at=NOW()
             WHERE order_id=?",
            [$status, $gwTxnId, $responseData ? json_encode($responseData) : null, $orderId]
        );
    }

    /** Unified JSON response helper */
    private function _jsonResponse(array $data, int $statusCode = 200): void
    {
        $this->response = $this->response
            ->withStatus($statusCode)
            ->withType('application/json')
            ->withStringBody(json_encode($data));
    }

    // ── Razorpay QR Helpers ──────────────────────────────────────────────────────

    // =========================================================================
    // RAZORPAY UPI QR — Payment Link approach (auto-confirm)
    // =========================================================================

    /**
     * POST /ssms-fee-paid-details/create-razorpay-upi-link
     * Creates a Razorpay UPI payment link → returns { success, link_id, short_url, internal_order_id }
     * Frontend renders short_url as a QR code and polls checkRazorpayLinkStatus.
     */
    public function createRazorpayUpiLink(): void
    {
        $this->request->allowMethod(['post']);
        $this->autoRender = false;

        $clientCode = $this->_clientCode();
        $userName   = $this->_userName();
        $db         = ConnectionManager::get('default');

        $body         = $this->request->getData();
        $enrollmentId = trim((string)($body['enrollment_id'] ?? ''));
        $feeFor       = strtoupper(trim((string)($body['fee_for'] ?? 'SCH')));
        $rawFeeItems  = $body['selected_fee_items'] ?? [];
        $feeItems     = is_string($rawFeeItems) ? (json_decode($rawFeeItems, true) ?: []) : (array)$rawFeeItems;
        $amount       = round((float)($body['amount'] ?? $body['fee_paid_amount'] ?? 0), 2);

        if ($enrollmentId === '' || empty($feeItems) || $amount < 1) {
            $this->_jsonResponse(['success' => false, 'message' => 'Invalid request parameters.'], 422);
            return;
        }

        $credRow   = $db->execute(
            "SELECT razorpay_key_id, razorpay_key_secret, razorpay_env FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
            [$clientCode]
        )->fetchAssoc();
        $keyId     = trim((string)($credRow['razorpay_key_id']     ?? ''));
        $keySecret = trim((string)($credRow['razorpay_key_secret'] ?? ''));

        if (empty($keyId) || empty($keySecret)) {
            $this->_jsonResponse(['success' => false, 'message' => 'Razorpay not configured. Add credentials in Client Settings.'], 503);
            return;
        }

        $internalOrderId = 'RZPUPI' . $clientCode . time() . rand(100, 999);
        $amtPaise        = (int)round($amount * 100);

        // Get student name for the link
        $stuRow = $db->execute(
            "SELECT r.student_first_name, r.student_last_name, r.email_address, r.mobile_number
             FROM ssms_student_enrollment e
             INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id
             WHERE e.enrollment_id = ? LIMIT 1",
            [$enrollmentId]
        )->fetchAssoc();
        $stuName  = trim(($stuRow['student_first_name'] ?? '') . ' ' . ($stuRow['student_last_name'] ?? ''));
        $stuEmail = $stuRow['email_address'] ?? '';
        $stuPhone = preg_replace('/\D/', '', (string)($stuRow['mobile_number'] ?? ''));
        if (strlen($stuPhone) === 10) $stuPhone = '91' . $stuPhone;

        // Insert pending order
        try {
            $db->execute(
                "INSERT INTO ssms_online_orders
                    (order_id, ssms_client_code, enrollment_id, fee_for,
                     fee_items_json, amount_rupees, amount_paise, gateway,
                     status, initiated_by, created_at, updated_at)
                 VALUES (?,?,?,?,?,?,?,'Razorpay','Pending',?,NOW(),NOW())",
                [$internalOrderId, $clientCode, $enrollmentId, $feeFor,
                 json_encode($feeItems), $amount, $amtPaise, $userName]
            );
        } catch (\Exception $e) {
            Log::error('createRazorpayUpiLink DB error: ' . $e->getMessage());
            $this->_jsonResponse(['success' => false, 'message' => 'Could not create order record.'], 500);
            return;
        }

        // Call Razorpay: POST /v1/payment_links
        // Note: upi_link=true is live-mode only; standard payment links work in both modes
        // and can be QR-coded — customer scans → opens Razorpay checkout on phone → pays via UPI/card
        $razorpayEnv = trim((string)($credRow['razorpay_env'] ?? 'test'));
        $linkPayload = [
            'amount'            => $amtPaise,
            'currency'          => 'INR',
            'accept_partial'    => false,
            'description'       => 'Fee Payment - ' . ($stuName ?: $enrollmentId),
            'reference_id'      => $internalOrderId,
            'expire_by'         => time() + 1800,   // 30 min
            'notify'            => ['sms' => false, 'email' => false],
            'reminder_enable'   => false,
            'notes'             => ['internal_order_id' => $internalOrderId, 'client_code' => $clientCode],
        ];
        // Add upi_link only in live mode
        if ($razorpayEnv === 'live') {
            $linkPayload['upi_link'] = true;
        }
        if (!empty($stuName))  $linkPayload['customer']['name']    = $stuName;
        if (!empty($stuEmail)) $linkPayload['customer']['email']   = $stuEmail;
        if (!empty($stuPhone)) $linkPayload['customer']['contact'] = '+' . $stuPhone;

        $ch = curl_init('https://api.razorpay.com/v1/payment_links');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($linkPayload),
            CURLOPT_USERPWD        => $keyId . ':' . $keySecret,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
        ]);
        $raw      = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $resp = json_decode($raw, true);
        if ($httpCode !== 200 || empty($resp['id']) || empty($resp['short_url'])) {
            Log::warning('Razorpay payment_link failed (' . $httpCode . '): ' . $raw);
            $this->_jsonResponse([
                'success' => false,
                'message' => $resp['error']['description'] ?? ('Razorpay error ' . $httpCode . '. Check credentials.'),
            ], 502);
            return;
        }

        // Store link ID for polling
        $db->execute(
            "UPDATE ssms_online_orders SET gateway_txn_id=?, updated_at=NOW() WHERE order_id=?",
            [$resp['id'], $internalOrderId]
        );

        $this->_jsonResponse([
            'success'           => true,
            'link_id'           => $resp['id'],
            'short_url'         => $resp['short_url'],
            'internal_order_id' => $internalOrderId,
            'amount'            => $amount,
        ]);
    }

    /**
     * GET /ssms-fee-paid-details/check-razorpay-link-status?link_id=xxx&internal_order_id=xxx
     * Polls Razorpay for payment link status.
     * Returns JSON: { status: 'pending'|'paid', receipt_number }
     */
    public function checkRazorpayLinkStatus(): void
    {
        $this->request->allowMethod(['get']);
        $this->autoRender = false;

        $clientCode      = $this->_clientCode();
        $userName        = $this->_userName();
        $db              = ConnectionManager::get('default');
        $linkId          = trim((string)($this->request->getQuery('link_id')          ?? ''));
        $internalOrderId = trim((string)($this->request->getQuery('internal_order_id') ?? ''));

        if (empty($linkId) || empty($internalOrderId)) {
            $this->_jsonResponse(['status' => 'pending'], 200);
            return;
        }

        $credRow   = $db->execute(
            "SELECT razorpay_key_id, razorpay_key_secret FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
            [$clientCode]
        )->fetchAssoc();
        $keyId     = trim((string)($credRow['razorpay_key_id']     ?? ''));
        $keySecret = trim((string)($credRow['razorpay_key_secret'] ?? ''));

        $ch = curl_init('https://api.razorpay.com/v1/payment_links/' . urlencode($linkId));
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_USERPWD        => $keyId . ':' . $keySecret,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
        ]);
        $raw      = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200) {
            $this->_jsonResponse(['status' => 'pending'], 200);
            return;
        }

        $resp = json_decode($raw, true);
        if (($resp['status'] ?? '') !== 'paid') {
            $this->_jsonResponse(['status' => 'pending'], 200);
            return;
        }

        // Already processed?
        $order = $db->execute(
            "SELECT * FROM ssms_online_orders WHERE order_id = ? AND ssms_client_code = ? LIMIT 1",
            [$internalOrderId, $clientCode]
        )->fetchAssoc();

        if (empty($order)) {
            $this->_jsonResponse(['status' => 'pending'], 200);
            return;
        }
        if (($order['status'] ?? '') === 'Paid') {
            $this->_jsonResponse(['status' => 'paid', 'receipt_number' => $order['receipt_number'] ?? ''], 200);
            return;
        }

        // Get Razorpay payment ID from the link payments
        $rzpPaymentId = $resp['payments'][0]['payment_id'] ?? ($resp['id'] ?? $linkId);

        // Generate receipt number
        $receiptNumber = 'UPIQR' . strtoupper($clientCode) . date('ymd') . rand(1000, 9999);

        // Record each fee item
        $feeItems  = json_decode((string)($order['fee_items_json'] ?? '[]'), true) ?: [];
        $amount    = (float)($order['amount_rupees'] ?? 0);
        $now       = date('Y-m-d H:i:s');
        $remaining = $amount;
        $receiptFeeItems = [];

        foreach ($feeItems as $item) {
            if ($remaining <= 0) break;

            $lateFee         = (float)($item['late_fee']         ?? 0);
            $discountPercent = round((float)($item['discount_percent'] ?? 0), 2);
            $discountAmount  = round((float)($item['discount_amount']  ?? 0), 2);
            $taxPercent      = round((float)($item['tax_percent']      ?? 0), 2);
            $taxAmount       = round((float)($item['tax_amount']       ?? 0), 2);
            $originalFeeAmt  = round((float)($item['fee_amount']  ?? 0), 2);
            $balanceDue      = round((float)($item['balance_due'] ?? $originalFeeAmt), 2);

            $allocate  = round(min($remaining, $balanceDue + $lateFee), 2);
            $remaining = round($remaining - $allocate, 2);

            $netFeeAmt       = round($originalFeeAmt - $discountAmount, 2);
            $cashTowardFee   = round($allocate - $lateFee, 2);
            $totalNetWithTax = round($netFeeAmt + $taxAmount, 2);
            $proratedTax     = ($totalNetWithTax > 0 && $taxAmount > 0)
                ? round($taxAmount * ($cashTowardFee / $totalNetWithTax), 2) : 0.0;

            $db->execute(
                'INSERT INTO ssms_fee_paid_details
                    (enrollment_id, registration_id, fee_id, fee_item_id,
                     session_id, class_id, branch_id, ssms_client_code,
                     receipt_number, paid_amount, fee_paid_amount, late_fee,
                     discount_percent, discount_amount, discount_reason,
                     tax_percent, tax_amount,
                     payment_date, payment_method, admin_review, admin_user,
                     ssms_user_name, enrolled, created, modified)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [
                    $order['enrollment_id'],
                    (int)($item['registration_id'] ?? 0),
                    (int)($item['fee_id']          ?? 0),
                    (int)($item['fee_item_id']     ?? 0),
                    !empty($item['session_id'])  ? (int)$item['session_id']  : null,
                    !empty($item['class_id'])    ? (int)$item['class_id']    : null,
                    !empty($item['branch_id'])   ? (int)$item['branch_id']   : null,
                    $clientCode,
                    $receiptNumber,
                    $allocate,
                    round($allocate - $lateFee - $proratedTax, 2),
                    $lateFee,
                    $discountPercent, $discountAmount, '',
                    $taxPercent, $proratedTax,
                    date('Y-m-d'),
                    'UPI',
                    'Approved',
                    $userName, $userName, 1,
                    $now, $now,
                ]
            );

            $receiptFeeItems[] = [
                'fee_item_name'   => $item['fee_item_name'] ?? ('Fee #' . ($item['fee_item_id'] ?? '?')),
                'fee_amount'      => $originalFeeAmt,
                'discount_amount' => $discountAmount,
                'tax_amount'      => $proratedTax,
                'paid_amount'     => $allocate,
                'late_fee'        => $lateFee,
                'balance_amount'  => max(0, $balanceDue - ($allocate - $lateFee)),
            ];
        }

        // Mark order as Paid
        $db->execute(
            "UPDATE ssms_online_orders SET status='Paid', receipt_number=?, gateway_txn_id=?, updated_at=NOW() WHERE order_id=?",
            [$receiptNumber, $rzpPaymentId, $internalOrderId]
        );

        // Email receipt
        $stuRow = $db->execute(
            "SELECT r.email_address, r.student_first_name, r.student_last_name
             FROM ssms_student_enrollment e
             INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id
             WHERE e.enrollment_id = ? LIMIT 1",
            [$order['enrollment_id']]
        )->fetchAssoc();
        if (!empty($stuRow['email_address'])) {
            $fullName = trim(($stuRow['student_first_name'] ?? '') . ' ' . ($stuRow['student_last_name'] ?? ''));
            $this->_sendReceiptEmail($receiptNumber, $stuRow['email_address'], $fullName, (string)$order['enrollment_id'], $receiptFeeItems);
        }

        Log::info('Razorpay UPI link paid — link:' . $linkId . ' order:' . $internalOrderId . ' receipt:' . $receiptNumber);

        $this->_jsonResponse(['status' => 'paid', 'receipt_number' => $receiptNumber]);
    }

    // =========================================================================
    // RAZORPAY STANDARD CHECKOUT
    // =========================================================================

    /**
     * POST /ssms-fee-paid-details/create-razorpay-order
     * Step 1 — Create a Razorpay order and return order details to the frontend.
     * Returns JSON: { success, razorpay_order_id, internal_order_id, amount, currency, key_id }
     */
    public function createRazorpayOrder(): void
    {
        $this->request->allowMethod(['post']);
        $this->autoRender = false;

        $clientCode = $this->_clientCode();
        $userName   = $this->_userName();
        $db         = ConnectionManager::get('default');

        $body         = $this->request->getData();
        $enrollmentId = trim((string)($body['enrollment_id'] ?? ''));
        $feeFor       = strtoupper(trim((string)($body['fee_for'] ?? 'SCH')));
        $feeItems     = $body['selected_fee_items'] ?? [];
        $amount       = round((float)($body['amount'] ?? 0), 2);

        if ($enrollmentId === '' || empty($feeItems) || $amount < 1) {
            $this->_jsonResponse(['success' => false, 'message' => 'Invalid request parameters.'], 422);
            return;
        }

        // Read Razorpay credentials fresh from DB
        $credRow = $db->execute(
            "SELECT razorpay_key_id, razorpay_key_secret FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
            [$clientCode]
        )->fetchAssoc();
        $keyId     = trim((string)($credRow['razorpay_key_id']     ?? ''));
        $keySecret = trim((string)($credRow['razorpay_key_secret'] ?? ''));

        if (empty($keyId) || empty($keySecret)) {
            $this->_jsonResponse(['success' => false, 'message' => 'Razorpay is not configured. Add credentials in Client Settings.'], 503);
            return;
        }

        $internalOrderId = 'RZPCO' . $clientCode . time() . rand(100, 999);
        $amtPaise        = (int)round($amount * 100);

        // Insert pending order record
        try {
            $db->execute(
                "INSERT INTO ssms_online_orders
                    (order_id, ssms_client_code, enrollment_id, fee_for,
                     fee_items_json, amount_rupees, amount_paise, gateway,
                     status, initiated_by, created_at, updated_at)
                 VALUES (?,?,?,?,?,?,?,'Razorpay','Pending',?,NOW(),NOW())",
                [$internalOrderId, $clientCode, $enrollmentId, $feeFor,
                 json_encode($feeItems), $amount, $amtPaise, $userName]
            );
        } catch (\Exception $e) {
            Log::error('createRazorpayOrder DB error: ' . $e->getMessage());
            $this->_jsonResponse(['success' => false, 'message' => 'Could not create order record.'], 500);
            return;
        }

        // Call Razorpay: POST /v1/orders
        $payload = json_encode([
            'amount'   => $amtPaise,
            'currency' => 'INR',
            'receipt'  => $internalOrderId,
            'notes'    => ['internal_order_id' => $internalOrderId, 'client_code' => $clientCode],
        ]);

        $ch = curl_init('https://api.razorpay.com/v1/orders');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_USERPWD        => $keyId . ':' . $keySecret,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
        ]);
        $raw      = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        if ($curlErr) {
            $this->_jsonResponse(['success' => false, 'message' => 'Could not reach Razorpay: ' . $curlErr], 502);
            return;
        }

        $resp = json_decode($raw, true);
        if ($httpCode !== 200 || empty($resp['id'])) {
            Log::warning('Razorpay createOrder failed (' . $httpCode . '): ' . $raw);
            $this->_jsonResponse([
                'success' => false,
                'message' => $resp['error']['description'] ?? ('Razorpay error (' . $httpCode . ').'),
            ], 502);
            return;
        }

        // Store the Razorpay order ID against the internal order
        $db->execute(
            "UPDATE ssms_online_orders SET gateway_txn_id=?, updated_at=NOW() WHERE order_id=?",
            [$resp['id'], $internalOrderId]
        );

        $this->_jsonResponse([
            'success'           => true,
            'razorpay_order_id' => $resp['id'],
            'internal_order_id' => $internalOrderId,
            'amount'            => $amtPaise,
            'currency'          => 'INR',
            'key_id'            => $keyId,        // safe to expose to frontend
        ]);
    }

    /**
     * POST /ssms-fee-paid-details/verify-razorpay-payment
     * Step 3 — Verify HMAC signature, then record payment and generate receipt.
     * Returns JSON: { success, receipt_number, message }
     */
    public function verifyRazorpayPayment(): void
    {
        $this->request->allowMethod(['post']);
        $this->autoRender = false;

        $clientCode = $this->_clientCode();
        $userName   = $this->_userName();
        $userRole   = $this->_userRole();
        $db         = ConnectionManager::get('default');

        $body              = $this->request->getData();
        $razorpayPaymentId = trim((string)($body['razorpay_payment_id'] ?? ''));
        $razorpayOrderId   = trim((string)($body['razorpay_order_id']   ?? ''));
        $razorpaySignature = trim((string)($body['razorpay_signature']  ?? ''));
        $internalOrderId   = trim((string)($body['internal_order_id']   ?? ''));
        $feeItems          = $body['selected_fee_items'] ?? [];
        $paymentDate       = trim((string)($body['payment_date'] ?? date('Y-m-d')));

        if (empty($razorpayPaymentId) || empty($razorpayOrderId) || empty($razorpaySignature) || empty($internalOrderId)) {
            $this->_jsonResponse(['success' => false, 'message' => 'Missing payment verification fields.'], 400);
            return;
        }

        // Read key secret fresh from DB
        $credRow   = $db->execute(
            "SELECT razorpay_key_secret FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
            [$clientCode]
        )->fetchAssoc();
        $keySecret = trim((string)($credRow['razorpay_key_secret'] ?? ''));

        if (empty($keySecret)) {
            $this->_jsonResponse(['success' => false, 'message' => 'Razorpay not configured.'], 503);
            return;
        }

        // Verify HMAC-SHA256 signature
        $expectedSignature = hash_hmac('sha256', $razorpayOrderId . '|' . $razorpayPaymentId, $keySecret);
        if (!hash_equals($expectedSignature, $razorpaySignature)) {
            Log::warning('Razorpay signature mismatch — order:' . $razorpayOrderId . ' payment:' . $razorpayPaymentId);
            $this->_jsonResponse(['success' => false, 'message' => 'Payment verification failed. Signature mismatch.'], 400);
            return;
        }

        // Load internal order to get amount and enrollment
        $order = $db->execute(
            "SELECT * FROM ssms_online_orders WHERE order_id = ? AND ssms_client_code = ? LIMIT 1",
            [$internalOrderId, $clientCode]
        )->fetchAssoc();

        if (empty($order)) {
            $this->_jsonResponse(['success' => false, 'message' => 'Order not found.'], 404);
            return;
        }

        $enrollmentId = (string)($order['enrollment_id'] ?? '');
        $amount       = (float)($order['amount_rupees']  ?? 0);

        // Generate receipt number
        $receiptNumber = 'RZP' . strtoupper($clientCode) . date('ymd') . rand(1000, 9999);

        // Record each fee item as paid (same logic as collectFee)
        $now       = date('Y-m-d H:i:s');
        $remaining = $amount;
        $txns      = [];
        $receiptFeeItems = [];

        foreach ((array)$feeItems as $item) {
            if ($remaining <= 0) break;

            $lateFee         = (float)($item['late_fee']         ?? 0);
            $discountPercent = round((float)($item['discount_percent'] ?? 0), 2);
            $discountAmount  = round((float)($item['discount_amount']  ?? 0), 2);
            $taxPercent      = round((float)($item['tax_percent']      ?? 0), 2);
            $taxAmount       = round((float)($item['tax_amount']       ?? 0), 2);
            $originalFeeAmt  = round((float)($item['fee_amount']  ?? 0), 2);
            $balanceDue      = round((float)($item['balance_due'] ?? $originalFeeAmt), 2);

            $allocate  = round(min($remaining, $balanceDue + $lateFee), 2);
            $remaining = round($remaining - $allocate, 2);

            $netFeeAmt       = round($originalFeeAmt - $discountAmount, 2);
            $cashTowardFee   = round($allocate - $lateFee, 2);
            $totalNetWithTax = round($netFeeAmt + $taxAmount, 2);
            $proratedTax     = ($totalNetWithTax > 0 && $taxAmount > 0)
                ? round($taxAmount * ($cashTowardFee / $totalNetWithTax), 2) : 0.0;

            $db->execute(
                'INSERT INTO ssms_fee_paid_details
                    (enrollment_id, registration_id, fee_id, fee_item_id,
                     session_id, class_id, branch_id, ssms_client_code,
                     receipt_number, paid_amount, fee_paid_amount, late_fee,
                     discount_percent, discount_amount, discount_reason,
                     tax_percent, tax_amount,
                     payment_date, payment_method, admin_review, admin_user,
                     ssms_user_name, enrolled, created, modified)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [
                    $enrollmentId,
                    (int)($item['registration_id'] ?? 0),
                    (int)($item['fee_id']          ?? 0),
                    (int)($item['fee_item_id']     ?? 0),
                    !empty($item['session_id'])  ? (int)$item['session_id']  : null,
                    !empty($item['class_id'])    ? (int)$item['class_id']    : null,
                    !empty($item['branch_id'])   ? (int)$item['branch_id']   : null,
                    $clientCode,
                    $receiptNumber,
                    $allocate,
                    round($allocate - $lateFee - $proratedTax, 2),
                    $lateFee,
                    $discountPercent, $discountAmount, '',
                    $taxPercent, $proratedTax,
                    $paymentDate,
                    'Razorpay',
                    'Approved',
                    $userName, $userName, 1,
                    $now, $now,
                ]
            );
            $txns[] = $db->getDriver()->lastInsertId();

            $receiptFeeItems[] = [
                'fee_item_name'    => $item['fee_item_name'] ?? ('Fee #' . ($item['fee_item_id'] ?? '?')),
                'fee_amount'       => $originalFeeAmt,
                'discount_amount'  => $discountAmount,
                'tax_amount'       => $proratedTax,
                'paid_amount'      => $allocate,
                'late_fee'         => $lateFee,
                'balance_amount'   => max(0, $balanceDue - ($allocate - $lateFee)),
            ];
        }

        // Mark order as paid
        $db->execute(
            "UPDATE ssms_online_orders SET status='Paid', gateway_txn_id=?, updated_at=NOW() WHERE order_id=?",
            [$razorpayPaymentId, $internalOrderId]
        );

        // Auto-send receipt email
        $studentRow = $db->execute(
            "SELECT r.email_address, r.student_first_name, r.student_last_name
             FROM ssms_student_enrollment e
             INNER JOIN ssms_student_registration r ON r.registration_id = e.registration_id
             WHERE e.enrollment_id = ? LIMIT 1",
            [$enrollmentId]
        )->fetchAssoc();

        if (!empty($studentRow['email_address'])) {
            $fullName = trim(($studentRow['student_first_name'] ?? '') . ' ' . ($studentRow['student_last_name'] ?? ''));
            $this->_sendReceiptEmail($receiptNumber, $studentRow['email_address'], $fullName, $enrollmentId, $receiptFeeItems);
        }

        Log::info('Razorpay payment verified — order:' . $internalOrderId . ' payment:' . $razorpayPaymentId . ' receipt:' . $receiptNumber);

        $this->_jsonResponse([
            'success'        => true,
            'receipt_number' => $receiptNumber,
            'message'        => sprintf('Payment of ₹%.2f recorded. Receipt: %s', $amount, $receiptNumber),
        ]);
    }

    /**
     * POST /ssms-fee-paid-details/initiate-razorpay-qr
     * Creates a Razorpay UPI QR code for the given fee items.
     * Returns JSON: { success, order_id, image_url, qr_id, amount }
     */
    public function initiateRazorpayQr(): void
    {
        $this->request->allowMethod(['post']);
        $this->autoRender = false;

        $clientCode = $this->_clientCode();
        $userName   = $this->_userName();
        $db         = ConnectionManager::get('default');

        $body         = $this->request->getData();
        $enrollmentId = trim((string)($body['enrollment_id'] ?? ''));
        $feeFor       = strtoupper(trim((string)($body['fee_for']  ?? 'SCH')));
        $feeItems     = $body['selected_fee_items'] ?? [];
        $amount       = round((float)($body['amount'] ?? 0), 2);

        if ($enrollmentId === '' || empty($feeItems) || $amount <= 0) {
            $this->_jsonResponse(['success' => false, 'message' => 'Invalid request parameters.'], 422);
            return;
        }

        // Load client info (for header_text etc.) then override Razorpay keys with fresh DB read
        $ci = $this->_clientInfo();

        // Read Razorpay credentials fresh from DB to bypass any cache
        $credRow = $db->execute(
            "SELECT razorpay_key_id, razorpay_key_secret, razorpay_env FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
            [$clientCode]
        )->fetchAssoc();
        $keyId     = trim((string)($credRow['razorpay_key_id']     ?? ''));
        $keySecret = trim((string)($credRow['razorpay_key_secret'] ?? ''));
        $rzpEnv    = trim((string)($credRow['razorpay_env']        ?? 'test'));

        Log::debug('RazorpayQR creds — key_id=' . substr($keyId, 0, 12) . '*** env=' . $rzpEnv . ' key_id_len=' . strlen($keyId) . ' secret_len=' . strlen($keySecret));

        if (empty($keyId) || empty($keySecret)) {
            $this->_jsonResponse([
                'success' => false,
                'message' => 'Razorpay QR is not configured for this school. Please enter Razorpay credentials in Client Settings.',
            ], 503);
            return;
        }

        $orderId  = 'RZPQR' . $clientCode . time() . rand(100, 999);
        $amtPaise = (int)round($amount * 100);

        // QR expires in 30 minutes (min 2 min, max 2 hr per Razorpay docs)
        $closeBy = time() + 1800;

        // Insert pending order record
        try {
            $db->execute(
                "INSERT INTO ssms_online_orders
                    (order_id, ssms_client_code, enrollment_id, fee_for,
                     fee_items_json, amount_rupees, amount_paise, gateway,
                     status, initiated_by, created_at, updated_at)
                 VALUES (?,?,?,?,?,?,?,'Razorpay','Pending',?,NOW(),NOW())",
                [
                    $orderId, $clientCode, $enrollmentId, $feeFor,
                    json_encode($feeItems), $amount, $amtPaise, $userName,
                ]
            );
        } catch (\Exception $e) {
            Log::error('initiateRazorpayQr DB error: ' . $e->getMessage());
            $this->_jsonResponse(['success' => false, 'message' => 'Could not create order record.'], 500);
            return;
        }

        // Call Razorpay: POST /v1/payments/qr_codes
        $payload = json_encode([
            'type'          => 'upi_qr',
            'name'          => $ci['header_text'] . ' Fee Payment',
            'usage'         => 'single_use',
            'fixed_amount'  => true,
            'payment_amount'=> $amtPaise,
            'description'   => 'Fee payment — Order ' . $orderId,
            'close_by'      => $closeBy,
            'notes'         => [
                'order_id'    => $orderId,
                'client_code' => $clientCode,
            ],
        ]);

        $ch = curl_init('https://api.razorpay.com/v1/payments/qr_codes');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_USERPWD        => $keyId . ':' . $keySecret,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
        ]);
        $raw      = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        if ($curlErr) {
            $this->_updateOrderStatus($orderId, 'Failed', null, ['curl_error' => $curlErr], $db);
            $this->_jsonResponse(['success' => false, 'message' => 'Could not reach Razorpay: ' . $curlErr], 502);
            return;
        }

        $resp = json_decode($raw, true);
        if ($httpCode !== 200 || empty($resp['id']) || empty($resp['image_url'])) {
            Log::warning('Razorpay QR create failed (' . $httpCode . '): ' . $raw);
            $this->_updateOrderStatus($orderId, 'Failed', null, $resp ?? [], $db);
            $this->_jsonResponse([
                'success' => false,
                'message' => $resp['error']['description'] ?? 'Could not generate QR code. Try again.',
            ], 502);
            return;
        }

        $qrId     = $resp['id'];
        $imageUrl = $resp['image_url'];

        // Store the QR code ID so we can poll payments later
        $db->execute(
            "UPDATE ssms_online_orders SET gateway_txn_id=?, gateway_response_json=?, updated_at=NOW() WHERE order_id=?",
            [$qrId, json_encode($resp), $orderId]
        );

        $this->_jsonResponse([
            'success'   => true,
            'order_id'  => $orderId,
            'qr_id'     => $qrId,
            'image_url' => $imageUrl,
            'amount'    => $amount,
            'expires_at'=> $closeBy,
        ]);
    }

    /**
     * Poll Razorpay GET /v1/payments/qr-codes/{qr_id}/payments
     * Returns [status, paymentId, errorMessage]
     */
    private function _pollRazorpayStatus(string $orderId, array $order, $db): array
    {
        $clientCode = $order['ssms_client_code'] ?? '';
        $credRow    = [];
        if (!empty($clientCode)) {
            $credRow = $db->execute(
                "SELECT razorpay_key_id, razorpay_key_secret FROM ssms_clients
                 WHERE ssms_client_code=? LIMIT 1",
                [$clientCode]
            )->fetchAssoc() ?: [];
        }

        $keyId     = trim((string)($credRow['razorpay_key_id']     ?? ''));
        $keySecret = trim((string)($credRow['razorpay_key_secret'] ?? ''));

        if (empty($keyId) || empty($keySecret)) {
            return ['Pending', null, 'Razorpay credentials not configured for this school.'];
        }

        // qr_id was stored in gateway_txn_id when QR was created
        $qrId = trim((string)($order['gateway_txn_id'] ?? ''));
        if (empty($qrId) || strpos($qrId, 'qr_') !== 0) {
            return ['Pending', null, 'QR code ID not found. Please contact admin.'];
        }

        $ch = curl_init('https://api.razorpay.com/v1/payments/qr-codes/' . $qrId . '/payments');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_USERPWD        => $keyId . ':' . $keySecret,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_TIMEOUT        => 20,
        ]);
        $raw     = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if ($curlErr) {
            Log::warning("Razorpay QR status curl error for $orderId: $curlErr");
            return ['Pending', null, 'Gateway timeout. Please wait and refresh.'];
        }

        $resp  = json_decode($raw, true) ?? [];
        $items = $resp['items'] ?? [];

        // Find a captured payment
        $captured = null;
        foreach ($items as $item) {
            if (($item['status'] ?? '') === 'captured') {
                $captured = $item;
                break;
            }
        }

        if (!$captured) {
            // Check if QR was closed (no more payments possible)
            if ($httpCode === 200 && isset($resp['count']) && empty($items)) {
                // Still active, just no payments yet
                return ['Pending', null, null];
            }
            return ['Pending', null, null];
        }

        $paymentId = $captured['id'] ?? null;

        // Update DB: gateway_txn_id becomes the actual payment ID
        $this->_updateOrderStatus($orderId, 'Success', $paymentId, $resp, $db);

        if (($order['status'] ?? '') !== 'Success') {
            try {
                $receiptNumber = $this->_createReceiptFromOrder($order, $paymentId, $db);
                $db->execute(
                    "UPDATE ssms_online_orders SET receipt_number=?, updated_at=NOW() WHERE order_id=?",
                    [$receiptNumber, $orderId]
                );
            } catch (\Exception $e) {
                Log::error("_pollRazorpayStatus receipt creation error for $orderId: " . $e->getMessage());
                return ['Success', $paymentId, 'Payment received but receipt creation failed. Contact admin.'];
            }
        }

        return ['Success', $paymentId, null];
    }

    /**
     * Send a fee receipt email.
     * Called directly from collectFee (auto-send) and emailReceipt (manual resend).
     *
     * @param string     $receiptNo
     * @param string     $email
     * @param string     $studentName
     * @param int        $enrollmentId
     * @param array|null $prebuiltItems  When provided (auto-send after collectFee), skip DB
     *                                   re-query and use these items directly — mirrors the
     *                                   app's payStudentFees approach for correct balance.
     */
    private function _sendReceiptEmail(string $receiptNo, string $email, string $studentName, $enrollmentId, ?array $prebuiltItems = null): void
    {
        if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            log::warning("_sendReceiptEmail: skipped — invalid email '{$email}' for receipt #{$receiptNo}");
            return;
        }

        $db         = ConnectionManager::get('default');
        $clientCode = $this->_clientCode();
        $userName   = $this->_userName();

        // ── Fetch metadata row (payment_date, payment_method) ─────────────────
        $metaRow = $db->execute("
            SELECT fp.payment_date, fp.payment_method, fp.paid_amount, fp.late_fee
            FROM   ssms_fee_paid_details fp
            WHERE  fp.receipt_number   = ?
              AND  fp.ssms_client_code = ?
            ORDER BY fp.trxn_id ASC LIMIT 1
        ", [$receiptNo, $clientCode])->fetchAssoc();

        if (empty($metaRow) && empty($prebuiltItems)) {
            log::warning("_sendReceiptEmail: no rows found for receipt #{$receiptNo}");
            return;
        }

        $paymentDate   = $metaRow['payment_date']  ?? date('Y-m-d');
        $paymentMethod = $metaRow['payment_method'] ?? 'Cash';

        // ── Fee items ─────────────────────────────────────────────────────────
        if ($prebuiltItems !== null) {
            // Auto-send path: items are pre-computed at payment time (like the app)
            $feeItems = $prebuiltItems;
        } else {
            // Manual resend path: re-query the DB and compute balance from aggregates
            // Fetch receipt rows AND the total-ever-paid per fee_id/fee_item_id
            // in a single query using a correlated subquery — avoids any
            // enrollment_id type-casting mismatch between the parameter and the DB column.
            $rows = $db->execute("
                SELECT fp.enrollment_id,
                       fp.paid_amount, fp.fee_paid_amount, fp.late_fee,
                       fp.payment_date, fp.payment_method,
                       fp.fee_id, fp.fee_item_id, fp.class_id, fp.session_id,
                       COALESCE(fi.fee_item_name, CONCAT('Fee #', fp.fee_item_id)) AS fee_item_name,
                       fs.month_no,
                       COALESCE(fs.fee_amount, fp.fee_paid_amount, 0)         AS fee_amount,
                       COALESCE(fp.discount_percent, sd.discount_percent, 0)  AS discount_percent,
                       COALESCE(fp.discount_amount,  sd.discount_amount,  0)  AS discount_amount,
                       COALESCE(fp.tax_percent, fi.tax_percent, 0)            AS tax_percent,
                       COALESCE(fp.tax_amount,  0)                            AS tax_amount,
                       (SELECT SUM(fp2.paid_amount - COALESCE(fp2.late_fee, 0))
                        FROM ssms_fee_paid_details fp2
                        WHERE fp2.enrollment_id = fp.enrollment_id
                          AND fp2.fee_id        = fp.fee_id
                          AND fp2.fee_item_id   = fp.fee_item_id
                          AND fp2.paid_amount   > 0
                       )                                                       AS total_ever_paid
                FROM   ssms_fee_paid_details fp
                LEFT JOIN ssms_fee_items fi ON fi.fee_item_id = fp.fee_item_id
                LEFT JOIN ssms_fee_structure fs
                    ON fs.fee_id = fp.fee_id AND fs.fee_item_id = fp.fee_item_id
                LEFT JOIN ssms_student_discounts sd
                    ON sd.enrollment_id    = fp.enrollment_id
                   AND sd.fee_item_id      = fp.fee_item_id
                   AND sd.session_id       = fp.session_id
                   AND sd.class_id         = fp.class_id
                   AND sd.ssms_client_code = fp.ssms_client_code
                WHERE  fp.receipt_number   = ?
                  AND  fp.ssms_client_code = ?
                  AND  (fp.paid_amount > 0 OR fp.late_fee > 0)
                ORDER BY fp.trxn_id ASC
            ", [$receiptNo, $clientCode])->fetchAll('assoc');

            if (empty($rows)) {
                log::warning("_sendReceiptEmail: no rows found for receipt #{$receiptNo}");
                return;
            }

            // Use enrollment_id from DB row (stored as string) for correct display
            if (!empty($rows[0]['enrollment_id'])) {
                $enrollmentId = $rows[0]['enrollment_id'];
            }

            $feeItems = [];
            foreach ($rows as $row) {
                $feeAmt     = (float)$row['fee_amount'];
                $discAmt    = (float)($row['discount_amount'] ?? 0);
                $taxAmt     = (float)($row['tax_amount']      ?? 0);
                $netDue     = max(0, $feeAmt - $discAmt + $taxAmt);
                $totalPaid  = (float)($row['total_ever_paid'] ?? 0);
                $balanceAmt = round(max(0, $netDue - $totalPaid), 2);

                $feeItems[] = [
                    'fee_item_name'    => $row['fee_item_name'],
                    'month_no'         => $row['month_no']         ?? '',
                    'fee_amount'       => $feeAmt,
                    'discount_percent' => (float)($row['discount_percent'] ?? 0),
                    'discount_amount'  => $discAmt,
                    'tax_percent'      => (float)($row['tax_percent']      ?? 0),
                    'tax_amount'       => $taxAmt,
                    'paid_amount'      => (float)$row['paid_amount'],
                    'late_fee'         => (float)$row['late_fee'],
                    'balance_amount'   => $balanceAmt,
                ];
            }
        }

        $paidTotal     = round(array_sum(array_column($feeItems, 'paid_amount')),     2);
        $feeTotal      = round(array_sum(array_column($feeItems, 'fee_amount')),      2);
        $lateTotal     = round(array_sum(array_column($feeItems, 'late_fee')),        2);
        $taxTotal      = round(array_sum(array_column($feeItems, 'tax_amount')),      2);
        $discountTotal = round(array_sum(array_column($feeItems, 'discount_amount')), 2);
        $balanceTotal  = round(array_sum(array_column($feeItems, 'balance_amount')),  2);

        $ci          = $this->_clientInfo();
        $schoolName  = $ci['header_text'];
        //$fromAddress = !empty($ci['email']) ? $ci['email'] : env('EMAIL_FROM_ADDRESS', 'admin@managemyacademy.com');
        $fromAddress = env('EMAIL_FROM_ADDRESS', 'admin@managemyacademy.com');

        $transportConfig = \Cake\Core\Configure::read('EmailTransport.default') ?? [];
        $transportClass  = $transportConfig['className'] ?? 'Mail';
        log::error("_sendReceiptEmail: fromAddress='{$fromAddress}' | to={$email} | receipt={$receiptNo} from={$fromAddress}");

        try {
            $mailer = new Mailer('default');
        // log::error("Inside Mailer: transport='{$transportClass}' | fromName={$schoolName} | feeItems={$feeItems} from={$fromAddress}");

            $mailer
                ->setFrom([$fromAddress => $schoolName])
                ->setTo([$email => $studentName])
                ->setReplyTo([$fromAddress => $schoolName])
                ->setSubject("Fee Receipt #{$receiptNo} — {$schoolName}")
                ->setEmailFormat('html')
                ->viewBuilder()
                    ->setTemplate('fee_receipt')
                    ->setLayout('default')
                    ->setVars([
                        'schoolName'         => $schoolName,
                        'fromAddress'        => $fromAddress,
                        'fromName'           => $schoolName,
                        'schoolAddress'      => $ci['address'],
                        'schoolCity'         => $ci['city'],
                        'schoolState'        => $ci['state'],
                        'schoolZip'          => $ci['zip'],
                        'schoolEmailAddress' => $ci['email'],
                        'receiptNo'          => $receiptNo,
                        'studentName'        => $studentName,
                        'enrollmentId'       => $enrollmentId,
                        'paidAmount'         => $paidTotal,
                        'balanceAmount'      => $balanceTotal,
                        'feeAmount'          => $feeTotal,
                        'totalTax'           => $taxTotal,
                        'totalDiscount'      => $discountTotal,
                        'totalLateFee'       => $lateTotal,
                        'paymentDate'        => $paymentDate,
                        'paymentMethod'      => $paymentMethod,
                        'adminUser'          => $userName,
                        'feeItems'           => $feeItems,
                        'generatedOn'        => date('d M Y \a\t h:i A'),
                    ]);

            $result = $mailer->send();

            if (empty($result)) {
                throw new \RuntimeException(
                    "Mailer::send() returned empty — transport '{$transportClass}' may not be configured."
                );
            }

            log::error("_sendReceiptEmail: SUCCESS #{$receiptNo} → {$email}");

        } catch (\Exception $e) {
            log::error("_sendReceiptEmail FAILED: receipt=#{$receiptNo} | " . $e->getMessage());
        }
    }
}
