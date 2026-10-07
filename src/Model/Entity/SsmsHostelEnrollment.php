<?php
namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsStudentEnrollment Entity
 *
 * @property int $id
 * @property int $registration_id
 * @property string $enrollment_id
 * @property string $ssms_client_code
 * @property string $roll_number
 * @property int|null $previous_class_id
 * @property string|null $previous_section
 * @property string $session_name
 * @property int $class_id
 * @property int $section_id
 * @property string $course_medium
 * @property \Cake\I18n\FrozenTime $created
 * @property \Cake\I18n\FrozenTime $modified
 *
 * @property \App\Model\Entity\Registration $registration
 * @property \App\Model\Entity\Enrollment $enrollment
 * @property \App\Model\Entity\PreviousClass $previous_class
 * @property \App\Model\Entity\Class $class
 */
class SsmsHostelEnrollment extends Entity
{

    /**
     * Fields that can be mass assigned using newEntity() or patchEntity().
     *
     * Note that when '*' is set to true, this allows all unspecified fields to
     * be mass assigned. For security purposes, it is advised to set '*' to false
     * (or remove it), and explicitly make individual fields accessible as needed.
     *
     * @var array
     */
    protected array $_accessible = [
        'enrollment_id' => true,
        'ssms_client_code' => true,
        'session_id' => true,
        'class_id' => true,
        'section_id' => true,
		'branch_id' => true,
        'created' => true,
        'modified' => true,
		'current_status'=> true,
		'room_number'=> true,
		'seat_number'=> true,
        'de_enroll_date'=>true,
        'registration_id'=>true,
    ];
}
