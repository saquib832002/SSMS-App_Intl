<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsClasses Model
 *
 * @method \App\Model\Entity\SsmsClass newEmptyEntity()
 * @method \App\Model\Entity\SsmsClass newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsClass> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsClass get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsClass findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsClass patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsClass> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsClass|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsClass saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsClass>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsClass>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsClass>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsClass> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsClass>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsClass>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsClass>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsClass> deleteManyOrFail(iterable $entities, array $options = [])
 */
class SsmsClassesTable extends Table
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

        $this->setTable('ssms_classes');
        $this->setDisplayField('class_name');
        $this->setPrimaryKey('class_id');
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
            ->scalar('class_name')
            ->maxLength('class_name', 20)
            ->requirePresence('class_name', 'create')
            ->notEmptyString('class_name');

        $validator
            ->scalar('class_description')
            ->maxLength('class_description', 50)
            ->allowEmptyString('class_description');

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
        $rules->add($rules->isUnique(['class_name', 'ssms_client_code']), ['errorField' => 'class_name']);

        return $rules;
    }
}
