<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsBalancesheet Model
 *
 * @method \App\Model\Entity\SsmsBalancesheet newEmptyEntity()
 * @method \App\Model\Entity\SsmsBalancesheet newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsBalancesheet> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsBalancesheet get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsBalancesheet findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsBalancesheet patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsBalancesheet> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsBalancesheet|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsBalancesheet saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsBalancesheet>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsBalancesheet>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsBalancesheet>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsBalancesheet> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsBalancesheet>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsBalancesheet>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsBalancesheet>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsBalancesheet> deleteManyOrFail(iterable $entities, array $options = [])
 *
 * @mixin \Cake\ORM\Behavior\TimestampBehavior
 */
class SsmsBalancesheetTable extends Table
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

        $this->setTable('ssms_balancesheet');
        $this->setDisplayField('trxn_type');
        $this->setPrimaryKey('id');

        $this->addBehavior('Timestamp');
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
            ->date('trxn_date')
            ->requirePresence('trxn_date', 'create')
            ->notEmptyDate('trxn_date');

        $validator
            ->scalar('trxn_desc')
            ->maxLength('trxn_desc', 50)
            ->allowEmptyString('trxn_desc');

        $validator
            ->numeric('amount')
            ->requirePresence('amount', 'create')
            ->notEmptyString('amount');

        $validator
            ->scalar('trxn_type')
            ->maxLength('trxn_type', 20)
            ->requirePresence('trxn_type', 'create')
            ->notEmptyString('trxn_type');

        $validator
            ->numeric('balance')
            ->allowEmptyString('balance');

        $validator
            ->scalar('ssms_client_code')
            ->maxLength('ssms_client_code', 20)
            ->requirePresence('ssms_client_code', 'create')
            ->notEmptyString('ssms_client_code');

        return $validator;
    }
}
