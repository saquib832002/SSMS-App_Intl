<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsMaxMarks Model
 *
 * @method \App\Model\Entity\SsmsMaxMark newEmptyEntity()
 * @method \App\Model\Entity\SsmsMaxMark newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsMaxMark> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsMaxMark get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsMaxMark findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsMaxMark patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsMaxMark> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsMaxMark|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsMaxMark saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsMaxMark>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsMaxMark>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsMaxMark>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsMaxMark> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsMaxMark>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsMaxMark>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsMaxMark>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsMaxMark> deleteManyOrFail(iterable $entities, array $options = [])
 */
class SsmsMaxMarksTable extends Table
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

        $this->setTable('ssms_max_marks');
        $this->setDisplayField('ssms_client_code');
        $this->setPrimaryKey('id');
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
            ->integer('class_id')
            ->requirePresence('class_id', 'create')
            ->notEmptyString('class_id');

        $validator
            ->integer('subject_id')
            ->requirePresence('subject_id', 'create')
            ->notEmptyString('subject_id');

        $validator
            ->integer('theory_max_marks')
            ->allowEmptyString('theory_max_marks');

        $validator
            ->integer('internal_max_marks')
            ->allowEmptyString('internal_max_marks');

        $validator
            ->integer('practical_max_marks')
            ->allowEmptyString('practical_max_marks');

        $validator
            ->integer('max_marks')
            ->allowEmptyString('max_marks');

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
        $rules->add($rules->isUnique(['class_id', 'subject_id', 'ssms_client_code']), ['errorField' => 'class_id']);

        return $rules;
    }
}
