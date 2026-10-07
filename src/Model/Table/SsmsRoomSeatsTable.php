<?php
namespace App\Model\Table;

use Cake\ORM\Query;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

class SsmsRoomSeatsTable extends Table
{

    public function initialize(array $config): void
    {
        parent::initialize($config);

        $this->setTable('ssms_room_seats');
        $this->setDisplayField('seat_id');
        $this->setDisplayField('seat_number');
        $this->setPrimaryKey('seat_id');
		
		$this->belongsTo('SsmsBuilding', [
            'foreignKey' => 'building_id',
            'joinType' => 'INNER'
        ]);
		$this->belongsTo('SsmsRooms', [
            'foreignKey' => 'room_id',
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
            ->integer('seat_id')
            ->allowEmptyString('room_id', 'create');

        $validator
            ->scalar('seat_number')
            ->maxLength('seat_number', 32)
            ->requirePresence('seat_number', 'create')
            ->allowEmptyString('seat_number', false);
        return $validator;
    }
}
