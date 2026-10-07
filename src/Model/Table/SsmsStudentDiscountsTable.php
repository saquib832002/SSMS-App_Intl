<?php
declare(strict_types=1);

namespace App\Model\Table;

use Cake\ORM\Table;
use Cake\Validation\Validator;

class SsmsStudentDiscountsTable extends Table
{
    public function initialize(array $config): void
    {
        parent::initialize($config);

        $this->setTable('ssms_student_discounts');
        $this->setPrimaryKey('discount_id');
        $this->setDisplayField('discount_id');

        // Timestamps
        $this->addBehavior('Timestamp');

        // Associations
        $this->belongsTo('SsmsFeeItems', [
            'foreignKey' => 'fee_item_id',
            'joinType'   => 'INNER',
        ]);
    }

    public function validationDefault(Validator $validator): Validator
    {
        $validator
            ->integer('discount_id')
            ->allowEmptyString('discount_id', null, 'create');

        $validator
            ->scalar('enrollment_id')
            ->maxLength('enrollment_id', 50)
            ->requirePresence('enrollment_id', 'create')
            ->notEmptyString('enrollment_id');

        $validator
            ->integer('fee_item_id')
            ->requirePresence('fee_item_id', 'create')
            ->notEmptyString('fee_item_id');

        $validator
            ->integer('session_id')
            ->requirePresence('session_id', 'create')
            ->notEmptyString('session_id');

        $validator
            ->decimal('discount_percent')
            ->range('discount_percent', [0, 100], 'Discount percent must be between 0 and 100.')
            ->requirePresence('discount_percent', 'create')
            ->notEmptyString('discount_percent');

        $validator
            ->decimal('discount_amount')
            ->greaterThanOrEqual('discount_amount', 0)
            ->allowEmptyString('discount_amount');

        $validator
            ->scalar('reason')
            ->maxLength('reason', 255)
            ->allowEmptyString('reason');

        $validator
            ->scalar('ssms_client_code')
            ->maxLength('ssms_client_code', 50)
            ->requirePresence('ssms_client_code', 'create')
            ->notEmptyString('ssms_client_code');

        $validator
            ->scalar('created_by')
            ->maxLength('created_by', 100)
            ->allowEmptyString('created_by');

        return $validator;
    }
}