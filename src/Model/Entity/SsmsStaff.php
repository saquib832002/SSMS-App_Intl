<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsStaff Entity
 *
 * @property int $staff_id
 * @property string|null $staff_title
 * @property string $first_name
 * @property string $last_name
 * @property string $email_address
 * @property int $mobile_number
 * @property string $address
 * @property string $state
 * @property string $father_name
 * @property string $mother_name
 * @property \Cake\I18n\Date $date_of_birth
 * @property string $gender
 * @property \Cake\I18n\Date|null $date_of_hiring
 * @property int|null $years_of_experience
 * @property string $specialty
 * @property float|null $salary
 * @property string|null $staff_photo
 * @property string|null $id_proof
 * @property string|null $address_proof
 * @property string|null $experience_letter
 * @property int $category_id
 * @property string|null $hired
 * @property string|null $resigned
 * @property \Cake\I18n\Date|null $resignation_date
 * @property string $ssms_client_code
 * @property int $branch_id
 * @property \Cake\I18n\DateTime $created
 * @property \Cake\I18n\DateTime|null $modified
 */
class SsmsStaff extends Entity
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
        'staff_title' => true,
        'first_name' => true,
        'last_name' => true,
        'email_address' => true,
        'mobile_number' => true,
        'address' => true,
        'state' => true,
        'father_name' => true,
        'mother_name' => true,
        'date_of_birth' => true,
        'gender' => true,
        'date_of_hiring' => true,
        'years_of_experience' => true,
        'specialty' => true,
        'salary' => true,
        'expected_salary' => true,
        'staff_photo' => true,
        'id_proof' => true,
        'address_proof' => true,
        'experience_letter' => true,
        'category_id' => true,
        'hired' => true,
        'resigned' => true,
        'resignation_date' => true,
        'ssms_client_code' => true,
        'branch_id' => true,
        'created' => true,
        'modified' => true,
    ];
}
