<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsMaxMark Entity
 *
 * @property int $id
 * @property int $class_id
 * @property int $subject_id
 * @property int|null $theory_max_marks
 * @property int|null $internal_max_marks
 * @property int|null $practical_max_marks
 * @property int|null $max_marks
 * @property string $ssms_client_code
 */
class SsmsMaxMark extends Entity
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
        'class_id' => true,
        'subject_id' => true,
        'theory_max_marks' => true,
        'internal_max_marks' => true,
        'practical_max_marks' => true,
        'max_marks' => true,
        'ssms_client_code' => true,
    ];
}
