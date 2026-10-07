<?php
declare(strict_types=1);
namespace App\Model\Entity;
use Cake\ORM\Entity;

class SsmsTransportVehicle extends Entity
{
    protected array $_accessible = [
        'vehicle_number'   => true,
        'vehicle_name'     => true,
        'capacity'         => true,
        'model'            => true,
        'status'           => true,
        'ssms_client_code' => true,
        'created'          => true,
        'modified'         => true,
    ];
}