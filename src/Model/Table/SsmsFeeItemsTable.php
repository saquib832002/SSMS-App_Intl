<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsFeeItems Model
 *
 * @method \App\Model\Entity\SsmsFeeItem newEmptyEntity()
 * @method \App\Model\Entity\SsmsFeeItem newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsFeeItem> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsFeeItem get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsFeeItem findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsFeeItem patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsFeeItem> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsFeeItem|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsFeeItem saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsFeeItem>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsFeeItem>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsFeeItem>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsFeeItem> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsFeeItem>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsFeeItem>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsFeeItem>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsFeeItem> deleteManyOrFail(iterable $entities, array $options = [])
 */
class SsmsFeeItemsTable extends Table
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

        $this->setTable('ssms_fee_items');
        $this->setDisplayField('fee_item_name');
        $this->setPrimaryKey('fee_item_id');
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
            ->scalar('fee_item_name')
            ->maxLength('fee_item_name', 32)
            ->requirePresence('fee_item_name', 'create')
            ->notEmptyString('fee_item_name');

        $validator
            ->scalar('fee_type')
            ->maxLength('fee_type', 32)
            ->requirePresence('fee_type', 'create')
            ->notEmptyString('fee_type');

        $validator
            ->scalar('description')
            ->maxLength('description', 50)
            ->allowEmptyString('description');

        $validator
            ->scalar('fee_code')
            ->maxLength('fee_code', 50)
            ->requirePresence('fee_code', 'create')
            ->notEmptyString('fee_code');

        $validator
            ->scalar('category')
            ->maxLength('category', 50)
            ->requirePresence('category', 'create')
            ->notEmptyString('category');

        $validator
            ->scalar('ssms_client_code')
            ->maxLength('ssms_client_code', 20)
            ->requirePresence('ssms_client_code', 'create')
            ->notEmptyString('ssms_client_code');

        $validator
            ->decimal('tax_percent')
            ->allowEmptyString('tax_percent');

        $validator
            ->boolean('tax_inclusive')
            ->allowEmptyString('tax_inclusive');

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
        $rules->add($rules->isUnique(['fee_code', 'fee_for', 'ssms_client_code']), ['errorField' => 'fee_code']);

        return $rules;
    }
}