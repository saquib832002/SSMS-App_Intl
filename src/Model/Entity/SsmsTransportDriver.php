<?php
declare(strict_types=1);
namespace App\Model\Entity;
use Cake\ORM\Entity;

class SsmsTransportDriver extends Entity
{
    protected array $_accessible = [
        'driver_name'      => true,
        'mobile_number'    => true,
        'license_number'   => true,
        'license_expiry'   => true,
        'status'           => true,
        'ssms_client_code' => true,
        'created'          => true,
        'modified'         => true,
    ];
}