<?php
declare(strict_types=1);
namespace App\Model\Table;
use Cake\ORM\Table;

class SsmsTransportEnrollmentsTable extends Table
{
    public function initialize(array $config): void
    {
        parent::initialize($config);
        $this->setTable('ssms_transport_enrollments');
        $this->setPrimaryKey('transport_enrollment_id');
        $this->addBehavior('Timestamp');
        $this->belongsTo('SsmsTransportRoutes', ['foreignKey' => 'route_id']);
        $this->belongsTo('SsmsTransportStops',  ['foreignKey' => 'stop_id']);
    }
}