<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsSection Entity
 *
 * @property int $section_id
 * @property string $section_name
 * @property int $capacity
 * @property string $ssms_client_code
 * @property int $class_id
 * @property int|null $staff_id
 *
 * @property \App\Model\Entity\SsmsClass $class
 * @property \App\Model\Entity\SsmsStaff $staff
 */
class SsmsSection extends Entity
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
        'section_name' => true,
        'capacity' => true,
        'ssms_client_code' => true,
        'class_id' => true,
        'staff_id' => true,
        'class' => true,
        'staff' => true,
    ];
}
