<?php
declare(strict_types=1);
namespace App\Model\Entity;
use Cake\ORM\Entity;

class SsmsTransportAssignment extends Entity
{
    protected array $_accessible = [
        'route_id'         => true,
        'vehicle_id'       => true,
        'driver_id'        => true,
        'session_id'       => true,
        'effective_from'   => true,
        'effective_to'     => true,
        'ssms_client_code' => true,
        'created'          => true,
        'modified'         => true,
    ];
}