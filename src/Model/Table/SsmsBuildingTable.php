<?php
namespace App\Model\Table;

use Cake\ORM\Query;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

class SsmsBuildingTable extends Table
{

    public function initialize(array $config): void
    {
        parent::initialize($config);

        $this->setTable('ssms_building');
        //$this->setDisplayField('building_id');
        $this->setDisplayField('building_number');
        $this->setPrimaryKey('building_id');
    }

    /**
     * Default validation rules.
     *
     * @param \Cake\Validation\Validator $validator Validator instance.
     * @return \Cake\Validation\Validator
     */
    public function validationDefault(Validator $validator): Validator
    {
        $validator
            ->integer('building_id')
            ->allowEmptyString('building_id', 'create');

        $validator
            ->scalar('building_number')
            ->maxLength('building_number', 20)
            ->requirePresence('building_number', 'create')
            ->allowEmptyString('building_number', false);

        $validator
            ->scalar('building_type')
            ->maxLength('building_type', 32)
            ->requirePresence('building_type', 'create')
            ->allowEmptyString('building_type', false);

        $validator
            ->scalar('building_name')
            ->maxLength('building_name', 50)
            ->requirePresence('building_name', 'create')
            ->allowEmptyString('building_name', false);

        return $validator;
    }
}
