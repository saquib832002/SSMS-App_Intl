<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsFeepaidReceipt Model
 *
 * @method \App\Model\Entity\SsmsFeepaidReceipt newEmptyEntity()
 * @method \App\Model\Entity\SsmsFeepaidReceipt newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsFeepaidReceipt> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsFeepaidReceipt get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsFeepaidReceipt findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsFeepaidReceipt patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsFeepaidReceipt> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsFeepaidReceipt|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsFeepaidReceipt saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsFeepaidReceipt>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsFeepaidReceipt>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsFeepaidReceipt>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsFeepaidReceipt> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsFeepaidReceipt>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsFeepaidReceipt>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsFeepaidReceipt>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsFeepaidReceipt> deleteManyOrFail(iterable $entities, array $options = [])
 */
class SsmsFeepaidReceiptTable extends Table
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

        $this->setTable('ssms_feepaid_receipt');
        $this->setDisplayField('receipt_number');
        $this->setPrimaryKey('receipt_number');
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
            ->numeric('amount_paid')
            ->requirePresence('amount_paid', 'create')
            ->notEmptyString('amount_paid');

        $validator
            ->numeric('dicount_amount')
            ->requirePresence('dicount_amount', 'create')
            ->notEmptyString('dicount_amount');

        $validator
            ->scalar('discount_reason')
            ->maxLength('discount_reason', 50)
            ->requirePresence('discount_reason', 'create')
            ->notEmptyString('discount_reason');

        $validator
            ->scalar('payment_method')
            ->maxLength('payment_method', 32)
            ->requirePresence('payment_method', 'create')
            ->notEmptyString('payment_method');

        $validator
            ->scalar('card_trxn_id')
            ->maxLength('card_trxn_id', 32)
            ->allowEmptyString('card_trxn_id');

        $validator
            ->scalar('status')
            ->maxLength('status', 12)
            ->allowEmptyString('status');

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
        $rules->add($rules->isUnique(['receipt_number', 'amount_paid', 'ssms_client_code']), ['errorField' => 'receipt_number']);

        return $rules;
    }
}
