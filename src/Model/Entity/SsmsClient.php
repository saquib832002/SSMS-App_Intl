<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsClient Entity
 *
 * @property string $ssms_client_code
 * @property string $ssms_client_name
 * @property string $ssms_client_address
 * @property string $ssms_client_city
 * @property string $ssms_client_state
 * @property string $ssms_client_zip
 * @property string $ssms_client_email
 * @property int $ssms_client_phone
 * @property string|null $ssms_client_header_text
 * @property string|null $logo_name
 * @property string $currency
 * @property string $ssms_client_status
 * @property \Cake\I18n\Date $ssms_client_expiry_date
 * @property string $enroll_prefix
 * @property string $registration_prefix
 * @property \Cake\I18n\DateTime|null $created
 * @property \Cake\I18n\DateTime|null $modified
 */
class SsmsClient extends Entity
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
        'ssms_client_name' => true,
        'ssms_client_address' => true,
        'ssms_client_city' => true,
        'ssms_client_state' => true,
        'ssms_client_zip' => true,
        'ssms_client_email' => true,
        'ssms_client_phone' => true,
        'ssms_client_header_text' => true,
        'logo_name' => true,
        'currency' => true,
        'ssms_client_status' => true,
        'ssms_client_expiry_date' => true,
        'enroll_prefix' => true,
        'registration_prefix' => true,
        'created' => true,
        'modified' => true,
        'phonepe_merchant_id' => true,
        'phonepe_salt_key'    => true,
        'phonepe_salt_index'  => true,
        'phonepe_env'         => true,
    ];
}
