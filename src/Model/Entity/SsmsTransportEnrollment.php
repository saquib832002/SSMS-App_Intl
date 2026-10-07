<?php
declare(strict_types=1);
namespace App\Model\Entity;
use Cake\ORM\Entity;

class SsmsTransportEnrollment extends Entity
{
    protected array $_accessible = [
        'enrollment_id'    => true,
        'route_id'         => true,
        'stop_id'          => true,
        'pickup_stop_id'   => true,
        'dropoff_stop_id'  => true,
        'session_id'       => true,
        'branch_id'       => true,
        'class_id'       => true,
        'transport_type'   => true,
        'monthly_fare'     => true,
        'status'           => true,
        'ssms_client_code' => true,
        'created'          => true,
        'modified'         => true,
    ];
}