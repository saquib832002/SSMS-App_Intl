<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsSections Model
 *
 * @property \App\Model\Table\SsmsClassesTable&\Cake\ORM\Association\BelongsTo $Classes
 * @property \App\Model\Table\SsmsStaffTable&\Cake\ORM\Association\BelongsTo $Staffs
 *
 * @method \App\Model\Entity\SsmsSection newEmptyEntity()
 * @method \App\Model\Entity\SsmsSection newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsSection> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsSection get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsSection findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsSection patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsSection> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsSection|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsSection saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsSection>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsSection>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsSection>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsSection> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsSection>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsSection>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsSection>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsSection> deleteManyOrFail(iterable $entities, array $options = [])
 */
class SsmsSectionsTable extends Table
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

        $this->setTable('ssms_sections');
        $this->setDisplayField('section_id');
        $this->setDisplayField('section_name');

        $this->setPrimaryKey('section_id');

        $this->belongsTo('SsmsClasses', [
            'foreignKey' => 'class_id',
            'joinType' => 'INNER'
        ]);
		$this->belongsTo('SsmsStaff', [
            'foreignKey' => 'staff_id',
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
            ->scalar('section_name')
            ->maxLength('section_name', 20)
            ->requirePresence('section_name', 'create')
            ->notEmptyString('section_name');

        $validator
            ->integer('capacity')
            ->requirePresence('capacity', 'create')
            ->notEmptyString('capacity');

        $validator
            ->scalar('ssms_client_code')
            ->maxLength('ssms_client_code', 20)
            ->requirePresence('ssms_client_code', 'create')
            ->notEmptyString('ssms_client_code');

        $validator
            ->integer('class_id')
            ->notEmptyString('class_id');

        $validator
            ->allowEmptyString('staff_id');

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
          $rules->add($rules->existsIn(['class_id'], 'SsmsClasses'));
		$rules->add($rules->isUnique(['ssms_client_code','section_name','class_id','staff_id'], 'SsmsSections','SsmsClasses'));
        return $rules;
    }
}
