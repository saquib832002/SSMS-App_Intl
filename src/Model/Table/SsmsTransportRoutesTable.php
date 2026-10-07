<?php
declare(strict_types=1);
namespace App\Model\Table;
use Cake\ORM\Table;
use Cake\Validation\Validator;

class SsmsTransportRoutesTable extends Table
{
    public function initialize(array $config): void
    {
        parent::initialize($config);
        $this->setTable('ssms_transport_routes');
        $this->setPrimaryKey('route_id');
        $this->addBehavior('Timestamp');
        $this->hasMany('SsmsTransportStops', [
            'foreignKey' => 'route_id',
            'dependent'  => true,
        ]);
        $this->hasMany('SsmsTransportAssignments', [
            'foreignKey' => 'route_id',
        ]);
        $this->hasMany('SsmsTransportEnrollments', [
            'foreignKey' => 'route_id',
        ]);
    }
    public function validationDefault(Validator $validator): Validator
    {
        $validator->scalar('route_name')->maxLength('route_name', 150)->requirePresence('route_name', 'create')->notEmptyString('route_name');
        $validator->scalar('ssms_client_code')->requirePresence('ssms_client_code', 'create')->notEmptyString('ssms_client_code');
        return $validator;
    }
}