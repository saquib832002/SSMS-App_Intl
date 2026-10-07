<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsFeePaidDetail Entity
 *
 * @property int $trxn_id
 * @property string|null $receipt_number
 * @property float $fee_amount
 * @property float|null $late_fee
 * @property float|null $paid_amount
 * @property float $balance_amount
 * @property \Cake\I18n\Date|null $fee_paid_date
 * @property string|null $admin_review
 * @property string|null $admin_user
 * @property \Cake\I18n\Date|null $admin_review_date
 * @property \Cake\I18n\Date|null $payment_date
 * @property string $ssms_client_code
 * @property int $session_id
 * @property int $class_id
 * @property int $branch_id
 * @property string $enrollment_id
 * @property string $registration_id
 * @property int $fee_item_id
 * @property int $fee_id
 * @property string $enrolled
 * @property string $ssms_user_name
 *
 * @property \App\Model\Entity\Fee $fee
 */
class SsmsFeePaidDetail extends Entity
{
    /**
     * Fields that can be mass assigned using newEntity() or patchEntity().
     *
     * Note that when '*' is set to true, this allows all unspecified fields to
     * be mass assigned. For security purposes, it is advised to set '*' to false
     * (or remove it), and explicitly make individual fields accessible as needed.
     *
     * @var array<string, bool>
     */
    protected array $_accessible = [
        'receipt_number' => true,
        'fee_paid_amount' => true,
        'late_fee' => true,
        'paid_amount' => true,
        'balance_amount' => true,
        'fee_paid_date' => true,
        'admin_review' => true,
        'admin_user' => true,
        'admin_review_date' => true,
        'payment_date' => true,
        'ssms_client_code' => true,
        'session_id' => true,
        'class_id' => true,
        'branch_id' => true,
        'enrollment_id' => true,
        'registration_id' => true,
        'fee_item_id' => true,
        'fee_id' => true,
        'ssms_user_name' => true,
        'fee' => true,
        'payment_method' => true,
        'discount_amount' => true,
        'discount_percent' => true,
        'discount_reason' => true,
    ];
}
