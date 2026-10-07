<?php
namespace App\Model\Table;

use Cake\ORM\Query;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsSubjects Model
 *
 * @property |\Cake\ORM\Association\BelongsTo $Classes
 *
 * @method \App\Model\Entity\SsmsSubject get($primaryKey, $options = [])
 * @method \App\Model\Entity\SsmsSubject newEntity($data = null, array $options = [])
 * @method \App\Model\Entity\SsmsSubject[] newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsSubject|bool save(\Cake\Datasource\EntityInterface $entity, $options = [])
 * @method \App\Model\Entity\SsmsSubject|bool saveOrFail(\Cake\Datasource\EntityInterface $entity, $options = [])
 * @method \App\Model\Entity\SsmsSubject patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsSubject[] patchEntities($entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsSubject findOrCreate($search, callable $callback = null, $options = [])
 */
class SsmsSubjectsTable extends Table
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

        $this->setTable('ssms_subjects');
        $this->setDisplayField('subject_name');
        $this->setPrimaryKey('subject_id');

        $this->belongsTo('SsmsClasses', [
            'foreignKey' => 'class_id',
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
            ->integer('subject_id')
            ->allowEmptyString('subject_id', 'create');

        $validator
            ->scalar('subject_name')
            ->maxLength('subject_name', 50)
            ->requirePresence('subject_name', 'create')
            ->allowEmptyString('subject_name', false);
       

        // subject_code moved to ssms_class_subjects — no validation needed here
//       $validator
//            ->integer('max_marks')
//            ->requirePresence('max_marks', 'create')
//            ->allowEmptyString('max_marks', false);

//        $validator
//            ->scalar('ssms_client_code')
//            ->maxLength('ssms_client_code', 32)
//            ->requirePresence('ssms_client_code', 'create')
//            ->allowEmptyString('ssms_client_code', false);

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
        $rules->add($rules->isUnique(['ssms_client_code','subject_name','class_id'], 'SsmsSubjects','SsmsClasses'));

        return $rules;
    }
}
