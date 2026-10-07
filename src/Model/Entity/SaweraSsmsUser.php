<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Authentication\PasswordHasher\DefaultPasswordHasher; // Add this line
use Cake\ORM\Entity;


/**
 * SaweraSsmsUser Entity
 *
 * @property string $ssms_user_name
 * @property string $ssms_user_firstname
 * @property string $ssms_user_lastname
 * @property string $ssms_user_password
 * @property string|null $ssms_user_image
 * @property string $ssms_user_role
 * @property string $ssms_user_email
 * @property int|null $staff_id
 * @property int|null $branch_id
 * @property string|null $ssms_user_status
 * @property \Cake\I18n\DateTime|null $created
 * @property \Cake\I18n\DateTime|null $modified
 * @property string|null $ssms_client_code
 */
class SaweraSsmsUser extends Entity
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
        'ssms_user_name' => true,
        'ssms_user_firstname' => true,
        'ssms_user_lastname' => true,
        'ssms_user_password' => true,
        'ssms_user_image' => true,
        'ssms_user_role' => true,
        'ssms_user_email' => true,
        'mobile_number' => true,
        'staff_id' => true,
        'branch_id' => true,
        'ssms_user_status' => true,
        'created' => true,
        'modified' => true,
        'ssms_client_code' => true,
        'validationCode'=> true,
        'validationStatus'=> true,
    ];
	
	//protected function _setSsmsUserPassword(string $password) : ?string
 //   {
 //       if (strlen($password) > 0) {
	//		$hashFormat = '$2y$10$';
 //          	$salt = 'iusesomecrazystrings22';
 //           $hashSalt = $hashFormat . $salt; 
	//		return crypt($password, $hashSalt);
	//		
 //          // return (new DefaultPasswordHasher())->hash($password);
 //       }
 //       return null;
 //   }
}
