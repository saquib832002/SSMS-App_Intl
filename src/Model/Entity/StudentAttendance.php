<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * StudentAttendance Entity
 *
 * @property int $id
 * @property string $roll_number
 * @property string|null $attendance
 * @property \Cake\I18n\Date|null $attendance_date
 * @property \Cake\I18n\Date $created
 * @property \Cake\I18n\Date $modified
 * @property int $session_id
 * @property int $class_id
 * @property int $branch_id
 * @property string $enrollment_id
 * @property int $section_id
 * @property string $ssms_client_code
 *
 * @property \App\Model\Entity\SsmsBranch $branch
 * @property \App\Model\Entity\SsmsStudentEnrollment $enrollment
 */
class StudentAttendance extends Entity
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
        'roll_number' => true,
        'attendance' => true,
        'attendance_date' => true,
        'created' => true,
        'modified' => true,
        'session_id' => true,
        'class_id' => true,
        'branch_id' => true,
        'enrollment_id' => true,
        'section_id' => true,
        'ssms_client_code' => true,
    ];
}
