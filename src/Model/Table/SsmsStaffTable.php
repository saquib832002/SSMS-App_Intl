<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsStaff Model
 *
 * @method \App\Model\Entity\SsmsStaff newEmptyEntity()
 * @method \App\Model\Entity\SsmsStaff newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsStaff> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsStaff get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsStaff findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsStaff patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsStaff> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsStaff|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsStaff saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsStaff>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsStaff>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsStaff>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsStaff> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsStaff>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsStaff>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsStaff>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsStaff> deleteManyOrFail(iterable $entities, array $options = [])
 *
 * @mixin \Cake\ORM\Behavior\TimestampBehavior
 */
class SsmsStaffTable extends Table
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

        $this->setTable('ssms_staff');
        $this->setDisplayField('first_name');
        $this->setPrimaryKey('staff_id');

        $this->addBehavior('Timestamp');
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
            ->scalar('staff_title')
            ->maxLength('staff_title', 20)
            ->allowEmptyString('staff_title');

        $validator
            ->scalar('first_name')
            ->maxLength('first_name', 32)
            ->requirePresence('first_name', 'create')
            ->notEmptyString('first_name');

        $validator
            ->scalar('last_name')
            ->maxLength('last_name', 32)
            ->requirePresence('last_name', 'create')
            ->notEmptyString('last_name');

        $validator
            ->scalar('email_address')
            ->maxLength('email_address', 50)
            ->requirePresence('email_address', 'create')
            ->notEmptyString('email_address');

        $validator
            ->requirePresence('mobile_number', 'create')
            ->notEmptyString('mobile_number');

        $validator
            ->scalar('address')
            ->maxLength('address', 50)
            ->requirePresence('address', 'create')
            ->notEmptyString('address');

        $validator
            ->scalar('state')
            ->maxLength('state', 32)
            ->requirePresence('state', 'create')
            ->notEmptyString('state');

        $validator
            ->scalar('father_name')
            ->maxLength('father_name', 32)
            ->requirePresence('father_name', 'create')
            ->notEmptyString('father_name');

        $validator
            ->scalar('mother_name')
            ->maxLength('mother_name', 32)
            ->requirePresence('mother_name', 'create')
            ->notEmptyString('mother_name');

        $validator
            ->date('date_of_birth')
            ->requirePresence('date_of_birth', 'create')
            ->notEmptyDate('date_of_birth');

        $validator
            ->scalar('gender')
            ->maxLength('gender', 32)
            ->requirePresence('gender', 'create')
            ->notEmptyString('gender');

        $validator
            ->date('date_of_hiring')
            ->allowEmptyDate('date_of_hiring');

        $validator
            ->integer('years_of_experience')
            ->allowEmptyString('years_of_experience');

        $validator
            ->scalar('specialty')
            ->maxLength('specialty', 50)
            ->requirePresence('specialty', 'create')
            ->notEmptyString('specialty');

        $validator
            ->numeric('salary')
            ->allowEmptyString('salary');

        $validator
            ->scalar('staff_photo')
            ->maxLength('staff_photo', 32)
            ->allowEmptyString('staff_photo');

        $validator
            ->scalar('id_proof')
            ->maxLength('id_proof', 32)
            ->allowEmptyString('id_proof');

        $validator
            ->scalar('address_proof')
            ->maxLength('address_proof', 32)
            ->allowEmptyString('address_proof');

        $validator
            ->scalar('experience_letter')
            ->maxLength('experience_letter', 32)
            ->allowEmptyString('experience_letter');

        $validator
            ->integer('category_id')
            ->requirePresence('category_id', 'create')
            ->notEmptyString('category_id');

        $validator
            ->scalar('hired')
            ->maxLength('hired', 5)
            ->allowEmptyString('hired');

        $validator
            ->scalar('resigned')
            ->maxLength('resigned', 5)
            ->allowEmptyString('resigned');

        $validator
            ->date('resignation_date')
            ->allowEmptyDate('resignation_date');

        $validator
            ->scalar('ssms_client_code')
            ->maxLength('ssms_client_code', 20)
            ->requirePresence('ssms_client_code', 'create')
            ->notEmptyString('ssms_client_code');

        $validator
            ->integer('branch_id')
            ->requirePresence('branch_id', 'create')
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
        $rules->add($rules->isUnique(['first_name', 'last_name', 'date_of_birth']), ['errorField' => 'first_name']);

        return $rules;
    }
}
