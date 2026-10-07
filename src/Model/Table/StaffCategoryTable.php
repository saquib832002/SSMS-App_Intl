<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * StaffCategory Model
 *
 * @method \App\Model\Entity\StaffCategory newEmptyEntity()
 * @method \App\Model\Entity\StaffCategory newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\StaffCategory> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\StaffCategory get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\StaffCategory findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\StaffCategory patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\StaffCategory> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\StaffCategory|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\StaffCategory saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\StaffCategory>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\StaffCategory>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\StaffCategory>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\StaffCategory> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\StaffCategory>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\StaffCategory>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\StaffCategory>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\StaffCategory> deleteManyOrFail(iterable $entities, array $options = [])
 *
 * @mixin \Cake\ORM\Behavior\TimestampBehavior
 */
class StaffCategoryTable extends Table
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

        $this->setTable('staff_category');
        $this->setDisplayField('category_name');
        $this->setPrimaryKey('category_id');

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
            ->scalar('category_name')
            ->maxLength('category_name', 32)
            ->requirePresence('category_name', 'create')
            ->notEmptyString('category_name');

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
        $rules->add($rules->isUnique(['category_name', 'ssms_client_code']), ['errorField' => 'category_name']);

        return $rules;
    }
}
