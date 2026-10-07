<?php
namespace App\Model\Table;

use Cake\ORM\Query;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsStudentEnrollment Model
 *
 * @property \App\Model\Table\RegistrationsTable|\Cake\ORM\Association\BelongsTo $SsmsStudentRegistration
 * @property \App\Model\Table\EnrollmentsTable|\Cake\ORM\Association\BelongsTo $SsmsStudentEnrollment
 * @property \App\Model\Table\PreviousClassesTable|\Cake\ORM\Association\BelongsTo $PreviousClasses
 * @property \App\Model\Table\ClassesTable|\Cake\ORM\Association\BelongsTo SsmsClasses
 *
 * @method \App\Model\Entity\SsmsStudentEnrollment get($primaryKey, $options = [])
 * @method \App\Model\Entity\SsmsStudentEnrollment newEntity($data = null, array $options = [])
 * @method \App\Model\Entity\SsmsStudentEnrollment[] newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsStudentEnrollment|bool save(\Cake\Datasource\EntityInterface $entity, $options = [])
 * @method \App\Model\Entity\SsmsStudentEnrollment|bool saveOrFail(\Cake\Datasource\EntityInterface $entity, $options = [])
 * @method \App\Model\Entity\SsmsStudentEnrollment patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsStudentEnrollment[] patchEntities($entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsStudentEnrollment findOrCreate($search, callable $callback = null, $options = [])
 *
 * @mixin \Cake\ORM\Behavior\TimestampBehavior
 */
class SsmsHostelEnrollmentTable extends Table
{

    /**
     * Initialize method
     *
     * @param array $config The configuration for the Table.
     * @return void
     */
    public function initialize(array $config): void
    {
        parent::initialize($config);

        $this->setTable('ssms_hostel_enrollment');
        $this->setDisplayField('enrollment_id');
        $this->setPrimaryKey('enrollment_id','session_id','class_id','section_id','ssms_client_code');

        $this->addBehavior('Timestamp');

//        $this->belongsTo('SsmsStudentRegistration', [
//            'foreignKey' => 'registration_id',
//            'joinType' => 'INNER'
//        ]);

//		  $this->belongsTo('ssms_student_registration', [
//            'foreignKey' => 'class_id'
//        ]);
		
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
		
    }

    /**
     * Default validation rules.
     *
     * @param \Cake\Validation\Validator $validator Validator instance.
     * @return \Cake\Validation\Validator
     */
    public function validationDefault(Validator $validator): validator
    {
//        $validator
//             ->integer('id')
//            ->allowEmptyString('id', 'create');
        
        $validator
            ->scalar('ssms_client_code')
            ->maxLength('ssms_client_code', 32)
            ->requirePresence('ssms_client_code', 'create')
            ->allowEmptyString('ssms_client_code', false);
         $validator
            ->scalar('enrollment_id')
            ->maxLength('enrollment_id', 32)
            ->requirePresence('enrollment_id', 'create')
            ->allowEmptyString('enrollment_id', false);

       
       
        $validator
            ->integer('session_id')
            ->maxLength('session_id', 12)
            ->requirePresence('session_id', 'create')
            ->allowEmptyString('session_id', false);

        $validator
            ->integer('section_id')
            ->maxLength('section_id', 10)
            ->requirePresence('section_id', 'create')
            ->allowEmptyString('section_id', false);

        
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
        $rules->add($rules->existsIn(['enrollment_id'], 'SsmsStudentEnrollment'));

        $rules->add($rules->existsIn(['class_id'], 'SsmsClasses'));
        $rules->add($rules->existsIn(['session_id'], 'SsmsSessions'));
        $rules->add($rules->existsIn(['section_id'], 'SsmsSections'));
        $rules->add($rules->isUnique(['enrollment_id', 'session_id', 'class_id','section_id'], 'SsmsStudentEnrollment'));

        return $rules;
    }
}
