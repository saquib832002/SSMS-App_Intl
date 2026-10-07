<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsBranch Entity
 *
 * @property int $branch_id
 * @property string $branch_name
 * @property string $branch_address
 * @property string $ssms_client_code
 */
class SsmsBranch extends Entity
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
        'branch_name' => true,
        'branch_address' => true,
        'ssms_client_code' => true,
    ];
}
