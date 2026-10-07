<?php
namespace App\Model\Table;

use Cake\ORM\Query;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

class SsmsRoomsTable extends Table
{

    public function initialize(array $config): void
    {
        parent::initialize($config);

        $this->setTable('ssms_rooms');
        $this->setDisplayField('room_id');
        $this->setDisplayField('room_name');
        $this->setPrimaryKey('room_id');
		
		$this->belongsTo('SsmsBuilding', [
            'foreignKey' => 'building_id',
            'joinType' => 'INNER'
        ]);
		
    }

    /**
     * Default validation rules.
     *
     * @param \Cake\Validation\Validator $validator Validator instance.
     * @return \Cake\Validation\Validator
     */
    public function validationDefault(Validator $validator): validator
    {
        $validator
            ->integer('room_id')
            ->allowEmptyString('room_id', 'create');

        $validator
            ->scalar('room_name')
            ->maxLength('room_name', 32)
            ->requirePresence('room_name', 'create')
            ->allowEmptyString('room_name', false);
        return $validator;
    }
}
