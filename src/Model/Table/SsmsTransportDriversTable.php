<?php
declare(strict_types=1);
namespace App\Model\Table;
use Cake\ORM\Table;
use Cake\Validation\Validator;

class SsmsTransportDriversTable extends Table
{
    public function initialize(array $config): void
    {
        parent::initialize($config);
        $this->setTable('ssms_transport_drivers');
        $this->setPrimaryKey('driver_id');
        $this->addBehavior('Timestamp');
        $this->hasMany('SsmsTransportAssignments', ['foreignKey' => 'driver_id']);
    }
    public function validationDefault(Validator $validator): Validator
    {
        $validator->scalar('driver_name')->requirePresence('driver_name', 'create')->notEmptyString('driver_name');
        $validator->scalar('ssms_client_code')->requirePresence('ssms_client_code', 'create')->notEmptyString('ssms_client_code');
        return $validator;
    }
}