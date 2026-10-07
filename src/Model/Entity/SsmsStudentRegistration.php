<?php
namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsStudentRegistration Entity
 *
 * @property int $registration_id
 * @property string $student_title
 * @property string $student_first_name
 * @property string|null $student_middle_name
 * @property string|null $student_last_name
 * @property string|null $email_address
 * @property int $mobile_number
 * @property string $student_gender
 * @property string $session_id
 * @property \Cake\I18n\FrozenDate $student_dob
 * @property string|null $student_birth_place
 * @property string $student_nationality
 * @property int $registered_class_id_for
 * @property string $course_medium
 * @property string $student_physically_challenged
 * @property string|null $student_admission_type
 * @property string|null $previous_school
 * @property int|null $student_previous_class_id
 * @property int $branch_id
 * @property string $student_c_address_line_1
 * @property string|null $student_c_address_line_2
 * @property string $student_c_address_city
 * @property string $student_c_address_state
 * @property int|null $student_c_address_zip
 * @property string|null $student_c_address_homephone
 * @property string $student_p_address_line_1
 * @property string|null $student_p_address_line_2
 * @property string $student_p_address_city
 * @property string $student_p_address_state
 * @property int|null $student_p_address_zip
 * @property int|null $student_p_address_homephone
 * @property string $student_father_name
 * @property string|null $father_qualification
 * @property int $father_age
 * @property string|null $father_occupation
 * @property string $student_mother_name
 * @property string|null $mother_qualification
 * @property int $mother_age
 * @property string|null $mother_occupation
 * @property string|null $student_image
 * @property string|null $enroll_status
 * @property \Cake\I18n\FrozenTime $created
 * @property \Cake\I18n\FrozenTime $modified
 * @property string $ssms_client_code
 *
 * @property \App\Model\Entity\SsmsClass $ssms_class
 * @property \App\Model\Entity\SsmsBranch $ssms_branch
 */
class SsmsStudentRegistration extends Entity
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
		'registration_id' => true,
        'student_title' => true,
        'student_first_name' => true,
        'student_middle_name' => true,
        'student_last_name' => true,
        'email_address' => true,
        'mobile_number' => true,
        'student_gender' => true,
        'session_id' => true,
        'student_dob' => true,
        'student_birth_place' => true,
        'student_nationality' => true,
        'registered_class_id_for' => true,
        'course_medium' => true,
        'student_physically_challenged' => true,
        'student_admission_type' => true,
        'previous_school' => true,
        'class_id' => true,
        'branch_id' => true,
        'student_c_address_line_1' => true,
        'student_c_address_line_2' => true,
        'student_c_address_city' => true,
        'student_c_address_state' => true,
        'student_c_address_zip' => true,
        'student_c_address_homephone' => true,
        'student_p_address_line_1' => true,
        'student_p_address_line_2' => true,
        'student_p_address_city' => true,
        'student_p_address_state' => true,
        'student_p_address_zip' => true,
        'student_p_address_homephone' => true,
        'student_father_name' => true,
        'father_qualification' => true,
        'father_age' => true,
        'father_occupation' => true,
        'student_mother_name' => true,
        'mother_qualification' => true,
        'mother_age' => true,
        'mother_occupation' => true,
        'student_image' => true,
        'enroll_status' => true,
        'created' => true,
        'modified' => true,
        'ssms_client_code' => true,
        'ssms_class' => true,
        'ssms_branch' => true,
        'student_photo' => true,
        'dob_cert' => true,
        'prev_marksheet' => true,
        'prev_slc' => true,
        'admission_number'=>true,
        'caste' => true,
        'religion' => true,
    ];
}
