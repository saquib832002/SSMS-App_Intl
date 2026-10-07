<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsSessions Model
 *
 * @method \App\Model\Entity\SsmsSession newEmptyEntity()
 * @method \App\Model\Entity\SsmsSession newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsSession> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsSession get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsSession findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsSession patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsSession> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsSession|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsSession saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsSession>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsSession>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsSession>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsSession> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsSession>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsSession>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsSession>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsSession> deleteManyOrFail(iterable $entities, array $options = [])
 */
class SsmsSessionsTable extends Table
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

        $this->setTable('ssms_sessions');
        $this->setDisplayField('session_name');
        $this->setPrimaryKey('session_id');
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
            ->scalar('session_name')
            ->maxLength('session_name', 20)
            ->requirePresence('session_name', 'create')
            ->notEmptyString('session_name');

        $validator
            ->scalar('is_current')
            ->maxLength('is_current', 1)
            ->requirePresence('is_current', 'create')
            ->notEmptyString('is_current');

        $validator
            ->scalar('active')
            ->maxLength('active', 5)
            ->requirePresence('active', 'create')
            ->notEmptyString('active');

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
        $rules->add($rules->isUnique(['session_name', 'ssms_client_code']), ['errorField' => 'session_name']);

        return $rules;
    }
}
