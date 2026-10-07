<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsClients Model
 *
 * @method \App\Model\Entity\SsmsClient newEmptyEntity()
 * @method \App\Model\Entity\SsmsClient newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsClient> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsClient get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsClient findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsClient patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsClient> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsClient|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsClient saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsClient>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsClient>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsClient>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsClient> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsClient>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsClient>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsClient>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsClient> deleteManyOrFail(iterable $entities, array $options = [])
 *
 * @mixin \Cake\ORM\Behavior\TimestampBehavior
 */
class SsmsClientsTable extends Table
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

        $this->setTable('ssms_clients');
        $this->setDisplayField('ssms_client_code');
        $this->setPrimaryKey('ssms_client_code');

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
            ->scalar('ssms_client_name')
            ->maxLength('ssms_client_name', 50)
            ->requirePresence('ssms_client_name', 'create')
            ->notEmptyString('ssms_client_name');

        $validator
            ->scalar('ssms_client_address')
            ->maxLength('ssms_client_address', 100)
            ->requirePresence('ssms_client_address', 'create')
            ->notEmptyString('ssms_client_address');

        $validator
            ->scalar('ssms_client_city')
            ->maxLength('ssms_client_city', 20)
            ->requirePresence('ssms_client_city', 'create')
            ->notEmptyString('ssms_client_city');

        $validator
            ->scalar('ssms_client_state')
            ->maxLength('ssms_client_state', 20)
            ->requirePresence('ssms_client_state', 'create')
            ->notEmptyString('ssms_client_state');

        $validator
            ->scalar('ssms_client_zip')
            ->maxLength('ssms_client_zip', 10)
            ->requirePresence('ssms_client_zip', 'create')
            ->notEmptyString('ssms_client_zip');

        $validator
            ->scalar('ssms_client_email')
            ->maxLength('ssms_client_email', 50)
            ->requirePresence('ssms_client_email', 'create')
            ->notEmptyString('ssms_client_email');

        $validator
            ->requirePresence('ssms_client_phone', 'create')
            ->notEmptyString('ssms_client_phone');

        $validator
            ->scalar('ssms_client_header_text')
            ->maxLength('ssms_client_header_text', 50)
            ->allowEmptyString('ssms_client_header_text');

        $validator
            ->scalar('logo_name')
            ->maxLength('logo_name', 50)
            ->allowEmptyString('logo_name');

        $validator
            ->scalar('currency')
            ->maxLength('currency', 20)
            ->requirePresence('currency', 'create')
            ->notEmptyString('currency');

        $validator
            ->scalar('ssms_client_status')
            ->maxLength('ssms_client_status', 10)
            ->requirePresence('ssms_client_status', 'create')
            ->notEmptyString('ssms_client_status');

        $validator
            ->date('ssms_client_expiry_date')
            ->requirePresence('ssms_client_expiry_date', 'create')
            ->notEmptyDate('ssms_client_expiry_date');

        $validator
            ->scalar('enroll_prefix')
            ->maxLength('enroll_prefix', 5)
            ->requirePresence('enroll_prefix', 'create')
            ->notEmptyString('enroll_prefix');

        $validator
            ->scalar('registration_prefix')
            ->maxLength('registration_prefix', 5)
            ->requirePresence('registration_prefix', 'create')
            ->notEmptyString('registration_prefix');

        return $validator;
    }
}
