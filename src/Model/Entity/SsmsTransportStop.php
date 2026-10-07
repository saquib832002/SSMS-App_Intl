<?php
declare(strict_types=1);
namespace App\Model\Entity;
use Cake\ORM\Entity;

class SsmsTransportStop extends Entity
{
    protected array $_accessible = [
        'route_id'         => true,
        'stop_name'        => true,
        'stop_order'       => true,
        'latitude'         => true,
        'longitude'        => true,
        'pickup_time'      => true,
        'dropoff_time'     => true,
        'ssms_client_code' => true,
        'created'          => true,
        'modified'         => true,
    ];
}