<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsFeeStructure Model
 *
 * @property \App\Model\Table\SsmsFeeItemsTable&\Cake\ORM\Association\BelongsTo $FeeItems
 * @property \App\Model\Table\SsmsBranchTable&\Cake\ORM\Association\BelongsTo $Branches
 *
 * @method \App\Model\Entity\SsmsFeeStructure newEmptyEntity()
 * @method \App\Model\Entity\SsmsFeeStructure newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsFeeStructure> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsFeeStructure get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsFeeStructure findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsFeeStructure patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsFeeStructure> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsFeeStructure|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsFeeStructure saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsFeeStructure>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsFeeStructure>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsFeeStructure>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsFeeStructure> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsFeeStructure>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsFeeStructure>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsFeeStructure>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsFeeStructure> deleteManyOrFail(iterable $entities, array $options = [])
 */
class SsmsFeeStructureTable extends Table
{
    /**
     * Initialize method
     *
     * @param array<string, mixed> $config The configuration for the Table.
     * @return void
     */
    public function initialize(array $config): void
    {
        parent::initialize($config);

        $this->setTable('ssms_fee_structure');
        $this->setDisplayField('ssms_client_code');
        $this->setPrimaryKey('fee_id');

        $this->belongsTo('SsmsFeeItems', [
            'foreignKey' => 'fee_item_id',
            'className' => 'SsmsFeeItems',
            'joinType' => 'LEFT',
        ]);
        $this->belongsTo('Branches', [
            'foreignKey' => 'branch_id',
            'className' => 'SsmsBranch',
            'joinType' => 'INNER',
        ]);
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
            ->integer('fee_item_id')
            ->notEmptyString('fee_item_id');

        $validator
            ->numeric('fee_amount')
            ->requirePresence('fee_amount', 'create')
            ->notEmptyString('fee_amount');
//
//        $validator
//            ->date('due_date')
//            ->requirePresence('due_date', 'create')
//            ->notEmptyDate('due_date');

        $validator
            ->integer('class_id')
            ->requirePresence('class_id', 'create')
            ->notEmptyString('class_id');

        $validator
            ->integer('session_id')
            ->requirePresence('session_id', 'create')
            ->notEmptyString('session_id');

        $validator
            ->integer('branch_id')
            ->notEmptyString('branch_id');

        $validator
            ->scalar('ssms_client_code')
            ->maxLength('ssms_client_code', 20)
            ->requirePresence('ssms_client_code', 'create')
            ->notEmptyString('ssms_client_code');
        
        
        return $validator;
    }

    /**
     * Returns a rules checker object that will be used for validating
     * application integrity.
     *
     * @param \Cake\ORM\RulesChecker $rules The rules object to be modified.
     * @return \Cake\ORM\RulesChecker
     */
    public function buildRules(RulesChecker $rules): RulesChecker
    {
        $rules->add($rules->isUnique(['class_id', 'session_id', 'ssms_client_code', 'fee_item_id', 'branch_id','month_no']), ['errorField' => 'class_id']);
        $rules->add($rules->existsIn(['fee_item_id'], 'SsmsFeeItems'), ['errorField' => 'fee_item_id']);
        $rules->add($rules->existsIn(['branch_id'], 'Branches'), ['errorField' => 'branch_id']);

        return $rules;
    }
}
