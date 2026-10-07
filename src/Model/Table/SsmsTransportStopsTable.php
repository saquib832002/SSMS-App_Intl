<?php
declare(strict_types=1);
namespace App\Model\Table;
use Cake\ORM\Table;
use Cake\Validation\Validator;

class SsmsTransportStopsTable extends Table
{
    public function initialize(array $config): void
    {
        parent::initialize($config);
        $this->setTable('ssms_transport_stops');
        $this->setPrimaryKey('stop_id');
        $this->addBehavior('Timestamp');
        $this->belongsTo('SsmsTransportRoutes', ['foreignKey' => 'route_id']);
    }
    public function validationDefault(Validator $validator): Validator
    {
        $validator->scalar('stop_name')->requirePresence('stop_name', 'create')->notEmptyString('stop_name');
        $validator->integer('route_id')->requirePresence('route_id', 'create')->notEmptyString('route_id');
        return $validator;
    }
}