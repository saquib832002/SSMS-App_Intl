<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsFeeStructure Entity
 *
 * @property int $fee_id
 * @property int $fee_item_id
 * @property float $fee_amount
 * @property \Cake\I18n\Date $due_date
 * @property int $class_id
 * @property int $session_id
 * @property int $branch_id
 * @property string $ssms_client_code
 *
 * @property \App\Model\Entity\SsmsFeeItem $fee_item
 * @property \App\Model\Entity\SsmsBranch $branch
 */
class SsmsFeeStructure extends Entity
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
        'fee_item_id' => true,
        'fee_amount' => true,
        'due_date' => true,
        'class_id' => true,
        'session_id' => true,
        'branch_id' => true,
        'ssms_client_code' => true,
        'fee_item' => true,
        'branch' => true,
        'month_no'=>true,
        
    ];
}
