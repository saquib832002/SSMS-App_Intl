<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsFeePaidDetails Model
 *
 * @property \App\Model\Table\SsmsFeeStructureTable&\Cake\ORM\Association\BelongsTo $Fees
 *
 * @method \App\Model\Entity\SsmsFeePaidDetail newEmptyEntity()
 * @method \App\Model\Entity\SsmsFeePaidDetail newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsFeePaidDetail> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsFeePaidDetail get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsFeePaidDetail findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsFeePaidDetail patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsFeePaidDetail> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsFeePaidDetail|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsFeePaidDetail saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsFeePaidDetail>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsFeePaidDetail>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsFeePaidDetail>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsFeePaidDetail> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsFeePaidDetail>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsFeePaidDetail>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsFeePaidDetail>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsFeePaidDetail> deleteManyOrFail(iterable $entities, array $options = [])
 */
class SsmsFeePaidDetailsTable extends Table
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

        $this->setTable('ssms_fee_paid_details');
        $this->setDisplayField('ssms_client_code');
        $this->setPrimaryKey('trxn_id');

        $this->belongsTo('Fees', [
            'foreignKey' => 'fee_id',
            'className' => 'SsmsFeeStructure',
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
            ->integer('trxn_id')->allowEmptyString('trxn_id', null, 'create')
            ->allowEmptyString('receipt_number')->maxLength('receipt_number', 80)
             ->requirePresence('fee_paid_amount',  'create')->allowEmptyString('fee_paid_amount')
            ->allowEmptyString('late_fee')
            ->allowEmptyString('paid_amount')
            ->allowEmptyString('balance_amount')
 
            ->date('fee_paid_date',     ['ymd'])->allowEmptyDate('fee_paid_date')
            ->date('payment_date',      ['ymd'])->allowEmptyDate('payment_date')
            ->date('admin_review_date', ['ymd'])->allowEmptyDate('admin_review_date')
 
            ->inList('admin_review', ['Pending', 'Approved', 'Rejected', 'Under Review'])
            ->allowEmptyString('admin_review')
 
            ->scalar('enrollment_id') ->allowEmptyString('enrollment_id')
            ->integer('class_id')      ->allowEmptyString('class_id')
            ->integer('branch_id')     ->allowEmptyString('branch_id')
            ->integer('session_id')    ->allowEmptyString('session_id')
            ->integer('fee_item_id')   ->allowEmptyString('fee_item_id')
            ->integer('fee_id')        ->allowEmptyString('fee_id')
            ->boolean('enrolled')      ->allowEmptyString('enrolled');
        
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
        $rules->add($rules->isUnique(['receipt_number','fee_id', 'fee_item_id', 'enrollment_id', 'session_id', 'class_id', 'branch_id'], ['allowMultipleNulls' => true]), ['errorField' => 'receipt_number']);
        $rules->add($rules->existsIn(['fee_id'], 'Fees'), ['errorField' => 'fee_id']);

        return $rules;
    }
}
