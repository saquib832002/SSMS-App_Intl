<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsSubjectTeacher Model
 *
 * @property \App\Model\Table\SsmsBranchTable&\Cake\ORM\Association\BelongsTo $Branches
 *
 * @method \App\Model\Entity\SsmsSubjectTeacher newEmptyEntity()
 * @method \App\Model\Entity\SsmsSubjectTeacher newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsSubjectTeacher> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsSubjectTeacher get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsSubjectTeacher findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsSubjectTeacher patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsSubjectTeacher> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsSubjectTeacher|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsSubjectTeacher saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsSubjectTeacher>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsSubjectTeacher>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsSubjectTeacher>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsSubjectTeacher> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsSubjectTeacher>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsSubjectTeacher>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsSubjectTeacher>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsSubjectTeacher> deleteManyOrFail(iterable $entities, array $options = [])
 */
class SsmsSubjectTeacherTable extends Table
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

        $this->setTable('ssms_subject_teacher');
        $this->setDisplayField('ssms_client_code');
        $this->setPrimaryKey('id');

        $this->belongsTo('Branches', [
            'foreignKey' => 'branch_id',
            'className' => 'SsmsBranch',
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
            ->scalar('ssms_client_code')
            ->maxLength('ssms_client_code', 20)
            ->requirePresence('ssms_client_code', 'create')
            ->notEmptyString('ssms_client_code');

        $validator
            ->integer('subject_id')
            ->requirePresence('subject_id', 'create')
            ->notEmptyString('subject_id');

        $validator
            ->integer('class_id')
            ->requirePresence('class_id', 'create')
            ->notEmptyString('class_id');

        $validator
            ->integer('section_id')
            ->requirePresence('section_id', 'create')
            ->notEmptyString('section_id');

        $validator
            ->integer('staff_id')
            ->requirePresence('staff_id', 'create')
            ->notEmptyString('staff_id');

        $validator
            ->integer('branch_id')
            ->notEmptyString('branch_id');

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
        $rules->add($rules->isUnique(['ssms_client_code', 'subject_id', 'class_id', 'section_id']), ['errorField' => 'ssms_client_code']);
        $rules->add($rules->existsIn(['branch_id'], 'Branches'), ['errorField' => 'branch_id']);

        return $rules;
    }
}
