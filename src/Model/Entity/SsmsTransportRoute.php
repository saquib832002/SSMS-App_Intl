<?php
declare(strict_types=1);
namespace App\Model\Entity;
use Cake\ORM\Entity;

class SsmsTransportRoute extends Entity
{
    protected array $_accessible = [
        'route_name'       => true,
        'route_code'       => true,
        'start_point'      => true,
        'end_point'        => true,
        'distance_km'      => true,
        'monthly_fare'     => true,
        'status'           => true,
        'ssms_client_code' => true,
        'created'          => true,
        'modified'         => true,
    ];
}