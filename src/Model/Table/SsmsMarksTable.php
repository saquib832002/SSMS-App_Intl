<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Query\SelectQuery;
use Cake\ORM\RulesChecker;
use Cake\ORM\Table;
use Cake\Validation\Validator;

/**
 * SsmsMarks Model
 *
 * @property \App\Model\Table\SsmsBranchTable&\Cake\ORM\Association\BelongsTo $Branches
 *
 * @method \App\Model\Entity\SsmsMark newEmptyEntity()
 * @method \App\Model\Entity\SsmsMark newEntity(array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsMark> newEntities(array $data, array $options = [])
 * @method \App\Model\Entity\SsmsMark get(mixed $primaryKey, array|string $finder = 'all', \Psr\SimpleCache\CacheInterface|string|null $cache = null, \Closure|string|null $cacheKey = null, mixed ...$args)
 * @method \App\Model\Entity\SsmsMark findOrCreate($search, ?callable $callback = null, array $options = [])
 * @method \App\Model\Entity\SsmsMark patchEntity(\Cake\Datasource\EntityInterface $entity, array $data, array $options = [])
 * @method array<\App\Model\Entity\SsmsMark> patchEntities(iterable $entities, array $data, array $options = [])
 * @method \App\Model\Entity\SsmsMark|false save(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method \App\Model\Entity\SsmsMark saveOrFail(\Cake\Datasource\EntityInterface $entity, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsMark>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsMark>|false saveMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsMark>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsMark> saveManyOrFail(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsMark>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsMark>|false deleteMany(iterable $entities, array $options = [])
 * @method iterable<\App\Model\Entity\SsmsMark>|\Cake\Datasource\ResultSetInterface<\App\Model\Entity\SsmsMark> deleteManyOrFail(iterable $entities, array $options = [])
 *
 * @mixin \Cake\ORM\Behavior\TimestampBehavior
 */
class SsmsMarksTable extends Table
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

        $this->setTable('ssms_marks');
        $this->setDisplayField('enrollment_id');
        $this->setPrimaryKey('id');

        $this->addBehavior('Timestamp');

        $this->belongsTo('Branches', [
            'foreignKey' => 'branch_id',
            'className' => 'SsmsBranch',
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
            ->integer('branch_id')
            ->notEmptyString('branch_id');

        $validator
            ->integer('exam_id')
            ->requirePresence('exam_id', 'create')
            ->notEmptyString('exam_id');

        $validator
            ->integer('session_id')
            ->requirePresence('session_id', 'create')
            ->notEmptyString('session_id');

        $validator
            ->integer('class_id')
            ->requirePresence('class_id', 'create')
            ->notEmptyString('class_id');

        $validator
            ->integer('section_id')
            ->requirePresence('section_id', 'create')
            ->notEmptyString('section_id');

        $validator
            ->integer('subject_id')
            ->requirePresence('subject_id', 'create')
            ->notEmptyString('subject_id');

        $validator
            ->scalar('enrollment_id')
            ->maxLength('enrollment_id', 32)
            ->requirePresence('enrollment_id', 'create')
            ->notEmptyString('enrollment_id');

        $validator
            ->numeric('theory_marks')
            ->allowEmptyString('theory_marks');

        $validator
            ->scalar('roll_number')
            ->maxLength('roll_number', 12)
            ->allowEmptyString('roll_number');

        $validator
            ->numeric('internal_marks')
            ->allowEmptyString('internal_marks');

        $validator
            ->numeric('practical_marks')
            ->allowEmptyString('practical_marks');

        $validator
            ->numeric('total_marks')
            ->allowEmptyString('total_marks');

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
        $rules->add($rules->isUnique(['exam_id', 'session_id', 'class_id', 'subject_id', 'ssms_client_code', 'enrollment_id']), ['errorField' => 'exam_id']);
        $rules->add($rules->existsIn(['branch_id'], 'Branches'), ['errorField' => 'branch_id']);

        return $rules;
    }
}
