<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsSession Entity
 *
 * @property int $session_id
 * @property string $session_name
 * @property string $is_current
 * @property string $active
 * @property string $ssms_client_code
 */
class SsmsSession extends Entity
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
        'session_name' => true,
        'is_current' => true,
        'active' => true,
        'ssms_client_code' => true,
    ];
}
