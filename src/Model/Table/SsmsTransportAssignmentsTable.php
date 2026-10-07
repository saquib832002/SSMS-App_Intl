<?php
declare(strict_types=1);
namespace App\Model\Table;
use Cake\ORM\Table;

class SsmsTransportAssignmentsTable extends Table
{
    public function initialize(array $config): void
    {
        parent::initialize($config);
        $this->setTable('ssms_transport_assignments');
        $this->setPrimaryKey('assignment_id');
        $this->addBehavior('Timestamp');
        $this->belongsTo('SsmsTransportRoutes',   ['foreignKey' => 'route_id']);
        $this->belongsTo('SsmsTransportVehicles', ['foreignKey' => 'vehicle_id']);
        $this->belongsTo('SsmsTransportDrivers',  ['foreignKey' => 'driver_id']);
    }
}