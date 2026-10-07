<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsStudentDiscount Entity
 *
 * @property int         $discount_id
 * @property string      $enrollment_id
 * @property int         $fee_item_id
 * @property int         $session_id
 * @property float       $discount_percent   0–100
 * @property float       $discount_amount    computed: fee_amount * percent / 100
 * @property string|null $reason             EWS / Scholarship / Staff ward etc.
 * @property string      $ssms_client_code
 * @property string|null $created_by
 * @property \Cake\I18n\DateTime $created
 * @property \Cake\I18n\DateTime $modified
 */
class SsmsStudentDiscount extends Entity
{
    /**
     * Fields that can be mass-assigned via newEntity() / patchEntity().
     * discount_id and timestamps are intentionally excluded.
     */
    protected array $_accessible = [
        'enrollment_id'    => true,
        'fee_item_id'      => true,
        'session_id'       => true,
        'discount_percent' => true,
        'discount_amount'  => true,
        'reason'           => true,
        'ssms_client_code' => true,
        'created_by'       => true,
        'created'          => true,
        'modified'         => true,
    ];

    /**
     * Virtual field: net amount after discount.
     * Usage: $entity->net_amount (requires $fee_amount to be set on entity)
     */
    protected function _getNetAmount(): ?float
    {
        if (!isset($this->_fields['fee_amount'])) {
            return null;
        }
        return round((float)$this->_fields['fee_amount'] - (float)($this->discount_amount ?? 0), 2);
    }
}