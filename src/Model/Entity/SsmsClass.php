<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsClass Entity
 *
 * @property int $class_id
 * @property string $class_name
 * @property string|null $class_description
 * @property string $ssms_client_code
 */
class SsmsClass extends Entity
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
        'class_name' => true,
        'class_description' => true,
        'ssms_client_code' => true,
    ];
}
