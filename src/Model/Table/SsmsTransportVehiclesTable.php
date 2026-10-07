<?php
declare(strict_types=1);
namespace App\Model\Table;
use Cake\ORM\Table;
use Cake\Validation\Validator;

class SsmsTransportVehiclesTable extends Table
{
    public function initialize(array $config): void
    {
        parent::initialize($config);
        $this->setTable('ssms_transport_vehicles');
        $this->setPrimaryKey('vehicle_id');
        $this->addBehavior('Timestamp');
        $this->hasMany('SsmsTransportAssignments', ['foreignKey' => 'vehicle_id']);
    }
    public function validationDefault(Validator $validator): Validator
    {
        $validator->scalar('vehicle_number')->requirePresence('vehicle_number', 'create')->notEmptyString('vehicle_number');
        $validator->scalar('ssms_client_code')->requirePresence('ssms_client_code', 'create')->notEmptyString('ssms_client_code');
        return $validator;
    }
}