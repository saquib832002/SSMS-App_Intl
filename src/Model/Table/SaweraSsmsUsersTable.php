<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SaweraSsmsUsers Model
 *
 * @method \App\Model\Entity\SaweraSsmsUser newEmptyEntity()
 * @method \App\Model\Entity\SaweraSsmsUser newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SaweraSsmsUser> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SaweraSsmsUser get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SaweraSsmsUser findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SaweraSsmsUser patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SaweraSsmsUser> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SaweraSsmsUser|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SaweraSsmsUser saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SaweraSsmsUser>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SaweraSsmsUser>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SaweraSsmsUser>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SaweraSsmsUser> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SaweraSsmsUser>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SaweraSsmsUser>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SaweraSsmsUser>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SaweraSsmsUser> deleteManyOrFail(iterable $entities, array $options = [])
 *
 * @mixin \Cake\ORM\Behavior\TimestampBehavior
 */
class SaweraSsmsUsersTable extends Table
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

        $this->setTable('sawera_ssms_users');
        $this->setDisplayField('ssms_user_name');
        $this->setPrimaryKey('ssms_user_name');

       // $this->addBehavior('Timestamp');
       $this->addBehavior('Timestamp', [
        'events' => [
        'Model.beforeSave' => [
            'created_on' => 'new',
            'updated_on' => 'always',
        ],
    ],
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
            ->scalar('ssms_user_firstname')
            ->maxLength('ssms_user_firstname', 20)
            ->requirePresence('ssms_user_firstname', 'create')
            ->notEmptyString('ssms_user_firstname');

        //$validator
        //    ->scalar('ssms_user_lastname')
        //    ->maxLength('ssms_user_lastname', 20)
        //    ->requirePresence('ssms_user_lastname', 'create')
        //    ->notEmptyString('ssms_user_lastname');

        $validator
            ->scalar('ssms_user_password')
            ->maxLength('ssms_user_password', 200)
            ->requirePresence('ssms_user_password', 'create')
            ->notEmptyString('ssms_user_password');

        $validator
            ->scalar('ssms_user_image')
            ->maxLength('ssms_user_image', 50)
            ->allowEmptyFile('ssms_user_image');

        $validator
            ->scalar('ssms_user_role')
            ->maxLength('ssms_user_role', 20)
            ->requirePresence('ssms_user_role', 'create')
            ->notEmptyString('ssms_user_role');

        //$validator
        //    ->scalar('ssms_user_email')
        //    ->maxLength('ssms_user_email', 50)
        //    ->requirePresence('ssms_user_email', 'create')
        //    ->notEmptyString('ssms_user_email');

        $validator
            ->allowEmptyString('staff_id');

        $validator
            ->integer('branch_id')
            ->allowEmptyString('branch_id');

        $validator
            ->scalar('ssms_user_status')
            ->maxLength('ssms_user_status', 10)
            ->allowEmptyString('ssms_user_status');

        $validator
            ->scalar('ssms_client_code')
            ->maxLength('ssms_client_code', 20)
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
        $rules->add($rules->isUnique(['ssms_user_name']), ['errorField' => 'ssms_user_name']);

        return $rules;
    }
}
