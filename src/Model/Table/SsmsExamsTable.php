<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsExams Model
 *
 * @method \App\Model\Entity\SsmsExam newEmptyEntity()
 * @method \App\Model\Entity\SsmsExam newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsExam> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsExam get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsExam findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsExam patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsExam> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsExam|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsExam saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsExam>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsExam>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsExam>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsExam> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsExam>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsExam>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsExam>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsExam> deleteManyOrFail(iterable $entities, array $options = [])
 */
class SsmsExamsTable extends Table
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

        $this->setTable('ssms_exams');
        $this->setDisplayField('exam_name');
        $this->setPrimaryKey('exam_id');
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
            ->scalar('exam_name')
            ->maxLength('exam_name', 50)
            ->requirePresence('exam_name', 'create')
            ->notEmptyString('exam_name');

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
        $rules->add($rules->isUnique(['exam_name', 'ssms_client_code']), ['errorField' => 'exam_name']);

        return $rules;
    }
}
