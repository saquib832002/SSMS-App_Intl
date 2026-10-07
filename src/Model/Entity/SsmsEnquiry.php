<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsEnquiry Entity
 *
 * @property int $enquiry_id
 * @property string $name
 * @property string $subject
 * @property string $from_email
 * @property int $mobile_number
 * @property string $message
 * @property string $address
 * @property \Cake\I18n\DateTime $created
 */
class SsmsEnquiry extends Entity
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
        'name' => true,
        'subject' => true,
        'from_email' => true,
        'mobile_number' => true,
        'message' => true,
        'address' => true,
        'created' => true,
    ];
}
