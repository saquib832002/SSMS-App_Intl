<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * StudentAttendance Model
 *
 * @property \App\Model\Table\SsmsBranchTable&\Cake\ORM\Association\BelongsTo $Branches
 * @property \App\Model\Table\SsmsStudentEnrollmentTable&\Cake\ORM\Association\BelongsTo $Enrollments
 *
 * @method \App\Model\Entity\StudentAttendance newEmptyEntity()
 * @method \App\Model\Entity\StudentAttendance newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\StudentAttendance> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\StudentAttendance get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\StudentAttendance findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\StudentAttendance patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\StudentAttendance> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\StudentAttendance|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\StudentAttendance saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\StudentAttendance>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\StudentAttendance>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\StudentAttendance>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\StudentAttendance> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\StudentAttendance>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\StudentAttendance>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\StudentAttendance>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\StudentAttendance> deleteManyOrFail(iterable $entities, array $options = [])
 *
 * @mixin \Cake\ORM\Behavior\TimestampBehavior
 */
class StudentAttendanceTable extends Table
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

        $this->setTable('student_attendance');
        $this->setDisplayField('roll_number');
        $this->setPrimaryKey('id');

        $this->addBehavior('Timestamp');

        $this->belongsTo('Branches', [
            'foreignKey' => 'branch_id',
            'className' => 'SsmsBranch',
            'joinType' => 'INNER',
        ]);
        $this->belongsTo('Enrollments', [
            'foreignKey' => 'enrollment_id',
            'className' => 'SsmsStudentEnrollment',
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
            ->scalar('roll_number')
            ->maxLength('roll_number', 12)
            ->requirePresence('roll_number', 'create')
            ->notEmptyString('roll_number');

        $validator
            ->scalar('attendance')
            ->maxLength('attendance', 1)
            ->allowEmptyString('attendance');

        $validator
            ->date('attendance_date')
            ->allowEmptyDate('attendance_date');

        $validator
            ->integer('session_id')
            ->requirePresence('session_id', 'create')
            ->notEmptyString('session_id');

        $validator
            ->integer('class_id')
            ->requirePresence('class_id', 'create')
            ->notEmptyString('class_id');

        $validator
            ->integer('branch_id')
            ->notEmptyString('branch_id');

        $validator
            ->scalar('enrollment_id')
            ->maxLength('enrollment_id', 32)
            ->notEmptyString('enrollment_id');

        $validator
            ->integer('section_id')
            ->requirePresence('section_id', 'create')
            ->notEmptyString('section_id');

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
        $rules->add($rules->isUnique(['roll_number', 'enrollment_id', 'session_id', 'attendance_date'], ['allowMultipleNulls' => true]), ['errorField' => 'roll_number']);
        $rules->add($rules->existsIn(['branch_id'], 'Branches'), ['errorField' => 'branch_id']);
        $rules->add($rules->existsIn(['enrollment_id'], 'Enrollments'), ['errorField' => 'enrollment_id']);

        return $rules;
    }
}
