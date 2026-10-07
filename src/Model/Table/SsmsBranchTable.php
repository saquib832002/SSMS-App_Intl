<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsBranch Model
 *
 * @method \App\Model\Entity\SsmsBranch newEmptyEntity()
 * @method \App\Model\Entity\SsmsBranch newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsBranch> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsBranch get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsBranch findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsBranch patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsBranch> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsBranch|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsBranch saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsBranch>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsBranch>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsBranch>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsBranch> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsBranch>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsBranch>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsBranch>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsBranch> deleteManyOrFail(iterable $entities, array $options = [])
 */
class SsmsBranchTable extends Table
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

        $this->setTable('ssms_branch');
        $this->setDisplayField('branch_id');
        $this->setDisplayField('branch_name');
        $this->setPrimaryKey('branch_id');
    
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
            ->scalar('branch_name')
            ->maxLength('branch_name', 50)
            ->requirePresence('branch_name', 'create')
            ->notEmptyString('branch_name');

        $validator
            ->scalar('branch_address')
            ->maxLength('branch_address', 50)
            ->requirePresence('branch_address', 'create')
            ->notEmptyString('branch_address');

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
        $rules->add($rules->isUnique(['branch_name', 'ssms_client_code']), ['errorField' => 'branch_name']);

        return $rules;
    }
}
