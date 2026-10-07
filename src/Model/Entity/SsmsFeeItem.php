<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsFeeItem Entity
 *
 * @property int $fee_item_id
 * @property string $fee_item_name
 * @property string $fee_type
 * @property string|null $description
 * @property string $fee_code
 * @property string $fee_for
 * @property string $ssms_client_code
 */
class SsmsFeeItem extends Entity
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
        'fee_item_name' => true,
        'fee_type' => true,
        'description' => true,
        'fee_code' => true,
        'category' => true,
        'ssms_client_code' => true,
        'status'=> true,
        'is_mandatory'=>true,
        'tax_percent' =>true,
        'tax_inclusive' =>true,
    ];
}
