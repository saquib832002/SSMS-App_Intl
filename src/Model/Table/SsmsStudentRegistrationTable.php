<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsStudentRegistration Model
 *
 * @property |\Cake\ORM\Association\BelongsTo $StudentPreviousClasses
 * @property |\Cake\ORM\Association\BelongsTo $Branches
 *
 * @method \App\Model\Entity\SsmsStudentRegistration get($primaryKey, $options = [])
 * @method \App\Model\Entity\SsmsStudentRegistration newEntity($data = null, array $options = [])
 * @method \App\Model\Entity\SsmsStudentRegistration[] newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsStudentRegistration|bool save(\Cake\Datasource\EntityInterface $entity, $options = [])
 * @method \App\Model\Entity\SsmsStudentRegistration|bool saveOrFail(\Cake\Datasource\EntityInterface $entity, $options = [])
 * @method \App\Model\Entity\SsmsStudentRegistration patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsStudentRegistration[] patchEntities($entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsStudentRegistration findOrCreate($search, callable $callback = null, $options = [])
 *
 * @mixin \Cake\ORM\Behavior\TimestampBehavior
 */
class SsmsStudentRegistrationTable extends Table
{
    public function initialize(array $config): void
    {
        parent::initialize($config);

        $this->setTable('ssms_student_registration');
        $this->setDisplayField('registration_id');
        $this->setPrimaryKey('registration_id');

        $this->addBehavior('Timestamp');

        $this->belongsTo('SsmsClasses', [
            'foreignKey' => 'class_id',
            'joinType' => 'INNER'
        ]);
        
         $this->belongsTo('SsmsSessions', [
            'foreignKey' => 'session_id',
            'joinType' => 'INNER'
        ]);
        $this->belongsTo('SsmsBranch', [
            'foreignKey' => 'branch_id',
            'joinType' => 'INNER'
        ]);
         $this->belongsTo('SsmsSections', [
            'foreignKey' => 'section_id',
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
            ->allowEmptyString('registration_id', 'create');

        $validator
            ->scalar('student_first_name')
            ->maxLength('student_first_name', 20)
            ->requirePresence('student_first_name', 'create')
            ->allowEmptyString('student_first_name');

      
        $validator
            ->requirePresence('mobile_number', 'create')
            ->allowEmptyString('mobile_number');

        $validator
            ->scalar('student_gender')
            ->maxLength('student_gender', 20)
            ->requirePresence('student_gender', 'create')
            ->allowEmptyString('student_gender');

        $validator
            ->scalar('session_id')
            ->maxLength('session_id', 11)
            ->requirePresence('session_id', 'create')
            ->allowEmptyString('session_id');

        $validator
            ->date('student_dob')
            ->requirePresence('student_dob', 'create')
            ->allowEmptyDate('student_dob');


        $validator
            ->integer('class_id')
            ->requirePresence('class_id', 'create')
            ->allowEmptyString('class_id');


        
        $validator
            ->scalar('student_c_address_line_1')
            ->maxLength('student_c_address_line_1', 50)
            ->requirePresence('student_c_address_line_1', 'create')
            ->allowEmptyString('student_c_address_line_1');

        //$validator
        //    ->scalar('student_c_address_city')
        //    ->maxLength('student_c_address_city', 50)
        //    ->requirePresence('student_c_address_city', 'create')
        //    ->allowEmptyString('student_c_address_city');
//
        //$validator
        //    ->scalar('student_c_address_state')
        //    ->maxLength('student_c_address_state', 20)
        //    ->requirePresence('student_c_address_state', 'create')
        //    ->allowEmptyString('student_c_address_state');
//
        //$validator
        //    ->scalar('student_c_address_homephone')
        //    ->maxLength('student_c_address_homephone', 50)
        //    ->allowEmptyString('student_c_address_homephone');

        //$validator
        //    ->scalar('student_p_address_line_1')
        //    ->maxLength('student_p_address_line_1', 50)
        //    ->requirePresence('student_p_address_line_1', 'create')
        //    ->allowEmptyString('student_p_address_line_1');

        $validator
            ->scalar('student_p_address_line_2')
            ->maxLength('student_p_address_line_2', 50)
            ->allowEmptyString('student_p_address_line_2');

        //$validator
        //    ->scalar('student_p_address_city')
        //    ->maxLength('student_p_address_city', 50)
        //    ->requirePresence('student_p_address_city', 'create')
        //    ->allowEmptyString('student_p_address_city');
//
        //$validator
        //    ->scalar('student_p_address_state')
        //    ->maxLength('student_p_address_state', 50)
        //    ->requirePresence('student_p_address_state', 'create')
        //    ->allowEmptyString('student_p_address_state');
		//$validator
        //    ->allowEmptyString('student_p_address_homephone');

        $validator
            ->scalar('student_father_name')
            ->maxLength('student_father_name', 50)
            ->requirePresence('student_father_name', 'create')
            ->allowEmptyString('student_father_name');

        $validator
            ->scalar('father_qualification')
            ->maxLength('father_qualification', 50)
            ->allowEmptyString('father_qualification');

        $validator
            ->integer('father_age')
            ->requirePresence('father_age', 'create')
            ->allowEmptyString('father_age');

        $validator
            ->scalar('father_occupation')
            ->maxLength('father_occupation', 50)
            ->allowEmptyString('father_occupation');

        $validator
            ->scalar('student_mother_name')
            ->maxLength('student_mother_name', 50)
            ->requirePresence('student_mother_name', 'create')
            ->allowEmptyString('student_mother_name');

        $validator
            ->scalar('mother_qualification')
            ->maxLength('mother_qualification', 50)
            ->allowEmptyString('mother_qualification');

        $validator
            ->integer('mother_age')
            ->requirePresence('mother_age', 'create')
            ->allowEmptyString('mother_age');

        $validator
            ->scalar('mother_occupation')
            ->maxLength('mother_occupation', 50)
            ->allowEmptyString('mother_occupation');
		$validator
            ->scalar('enroll_status')
            ->maxLength('enroll_status', 10)
            ->allowEmptyString('enroll_status');

        $validator
            ->scalar('ssms_client_code')
            ->maxLength('ssms_client_code', 32)
            ->requirePresence('ssms_client_code', 'create')
            ->allowEmptyString('ssms_client_code');

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
        $rules->add($rules->isUnique(['student_first_name', 'student_gender', 'student_father_name', 'student_dob','ssms_client_code','branch_id']));

        return $rules;
    }
}
