<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsStudentEnrollment Entity
 *
 * @property string $enrollment_id
 * @property string $roll_number
 * @property int|null $previous_class_id
 * @property int|null $previous_section
 * @property string $course_medium
 * @property \Cake\I18n\DateTime|null $created
 * @property \Cake\I18n\DateTime $modified
 * @property string $ssms_client_code
 * @property int $session_id
 * @property int $class_id
 * @property int $section_id
 * @property string $registration_id
 * @property int $branch_id
 * @property string|null $status
 *
 * @property \App\Model\Entity\SsmsBranch $branch
 * @property \App\Model\Entity\SsmsClass $ssms_class
 */
class SsmsStudentEnrollment extends Entity
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
        'previous_class_id' => true,
        'previous_section' => true,
        'course_medium' => true,
        'created' => true,
        'modified' => true,
        'ssms_client_code' => true,
        'section_id' => true,
        'registration_id' => true,
        'branch_id' => true,
        'status' => true,
        'branch' => true,
        'class_id' => true,
    ];
}
