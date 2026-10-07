<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsFeepaidReceipt Entity
 *
 * @property string $receipt_number
 * @property float $amount_paid
 * @property float $dicount_amount
 * @property string $discount_reason
 * @property string $payment_method
 * @property string|null $card_trxn_id
 * @property string|null $status
 * @property string $ssms_client_code
 */
class SsmsFeepaidReceipt extends Entity
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
        'amount_paid' => true,
        'dicount_amount' => true,
        'discount_reason' => true,
        'payment_method' => true,
        'card_trxn_id' => true,
        'status' => true,
        'ssms_client_code' => true,
    ];
}
