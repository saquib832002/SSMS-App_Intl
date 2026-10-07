<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsStudentEnrollment Model
 *
 * @property \App\Model\Table\SsmsBranchTable&\Cake\ORM\Association\BelongsTo $Branches
 *
 * @method \App\Model\Entity\SsmsStudentEnrollment newEmptyEntity()
 * @method \App\Model\Entity\SsmsStudentEnrollment newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsStudentEnrollment> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsStudentEnrollment get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsStudentEnrollment findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsStudentEnrollment patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsStudentEnrollment> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsStudentEnrollment|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsStudentEnrollment saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsStudentEnrollment>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsStudentEnrollment>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsStudentEnrollment>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsStudentEnrollment> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsStudentEnrollment>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsStudentEnrollment>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsStudentEnrollment>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsStudentEnrollment> deleteManyOrFail(iterable $entities, array $options = [])
 *
 * @mixin \Cake\ORM\Behavior\TimestampBehavior
 */
class SsmsStudentEnrollmentTable extends Table
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

        $this->setTable('ssms_student_enrollment');
        $this->setDisplayField('enrollment_id');
        $this->setPrimaryKey('enrollment_id','session_id','class_id');

        $this->addBehavior('Timestamp');

        $this->belongsTo('SsmsStudentRegistration', [
            'foreignKey' => 'registration_id',
            'joinType' => 'INNER'
        ]);

		
        $this->belongsTo('SsmsStudentEnrollment', [
            'foreignKey' => 'enrollment_id',
            'joinType' => 'INNER'
        ]);
        $this->belongsTo('SsmsSessions', [
            'foreignKey' => 'session_id',
            'joinType' => 'INNER'
        ]);
        $this->belongsTo('SsmsSections', [
            'foreignKey' => 'section_id',
            'joinType' => 'INNER'
        ]);
        $this->belongsTo('SsmsClasses', [
            'foreignKey' => 'class_id',
            'joinType' => 'INNER'
        ]);
        
		$this->belongsTo('SsmsBranch', [
            'foreignKey' => 'branch_id',
            'joinType' => 'INNER'
        ]);
		
        $this->belongsTo('SsmsExams', [
                'foreignKey' => false,
               'joinType' => 'INNER'
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
            ->scalar('roll_number')
            ->maxLength('roll_number', 10)
            ->requirePresence('roll_number', 'create')
            ->notEmptyString('roll_number');

        $validator
            ->integer('previous_class_id')
            ->allowEmptyString('previous_class_id');

        $validator
            ->integer('previous_section')
            ->allowEmptyString('previous_section');

        $validator
            ->scalar('course_medium')
            ->maxLength('course_medium', 32)
            ->requirePresence('course_medium', 'create')
            ->notEmptyString('course_medium');

        $validator
            ->scalar('ssms_client_code')
            ->maxLength('ssms_client_code', 20)
            ->requirePresence('ssms_client_code', 'create')
            ->notEmptyString('ssms_client_code');

        $validator
            ->integer('section_id')
            ->requirePresence('section_id', 'create')
            ->notEmptyString('section_id');

        $validator
            ->scalar('registration_id')
            ->maxLength('registration_id', 16)
            ->requirePresence('registration_id', 'create')
            ->notEmptyString('registration_id');

        $validator
            ->integer('branch_id')
            ->notEmptyString('branch_id');

        $validator
            ->scalar('status')
            ->maxLength('status', 20)
            ->allowEmptyString('status');

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
        $rules->add($rules->isUnique(['enrollment_id', 'session_id', 'class_id', 'section_id', 'registration_id', 'branch_id']), ['errorField' => 'enrollment_id']);
        $rules->add($rules->existsIn(['branch_id'], 'SsmsBranch'), ['errorField' => 'branch_id']);

        return $rules;
    }
}
