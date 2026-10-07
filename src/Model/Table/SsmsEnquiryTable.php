<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsEnquiry Model
 *
 * @method \App\Model\Entity\SsmsEnquiry newEmptyEntity()
 * @method \App\Model\Entity\SsmsEnquiry newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsEnquiry> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsEnquiry get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsEnquiry findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsEnquiry patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsEnquiry> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsEnquiry|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsEnquiry saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsEnquiry>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsEnquiry>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsEnquiry>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsEnquiry> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsEnquiry>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsEnquiry>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsEnquiry>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsEnquiry> deleteManyOrFail(iterable $entities, array $options = [])
 *
 * @mixin \Cake\ORM\Behavior\TimestampBehavior
 */
class SsmsEnquiryTable extends Table
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

        $this->setTable('ssms_enquiry');
        $this->setDisplayField('name');
        $this->setPrimaryKey('enquiry_id');

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
            ->scalar('name')
            ->maxLength('name', 50)
            ->requirePresence('name', 'create')
            ->notEmptyString('name');

        $validator
            ->scalar('subject')
            ->maxLength('subject', 50)
            ->requirePresence('subject', 'create')
            ->notEmptyString('subject');

        $validator
            ->scalar('from_email')
            ->maxLength('from_email', 50)
            ->requirePresence('from_email', 'create')
            ->notEmptyString('from_email');

        $validator
            ->requirePresence('mobile_number', 'create')
            ->notEmptyString('mobile_number');

        $validator
            ->scalar('message')
            ->maxLength('message', 500)
            ->requirePresence('message', 'create')
            ->notEmptyString('message');

        $validator
            ->scalar('address')
            ->maxLength('address', 100)
            ->requirePresence('address', 'create')
            ->notEmptyString('address');

        return $validator;
    }
}
