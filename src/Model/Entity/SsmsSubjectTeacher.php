<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsSubjectTeacher Entity
 *
 * @property int $id
 * @property string $ssms_client_code
 * @property int $subject_id
 * @property int $class_id
 * @property int $section_id
 * @property int $staff_id
 * @property int $branch_id
 *
 * @property \App\Model\Entity\SsmsBranch $branch
 */
class SsmsSubjectTeacher extends Entity
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
        'ssms_client_code' => true,
        'subject_id' => true,
        'class_id' => true,
        'section_id' => true,
        'staff_id' => true,
        'branch_id' => true,
        'branch' => true,
    ];
}
