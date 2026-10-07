<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsBalancesheet Entity
 *
 * @property int $id
 * @property \Cake\I18n\Date $trxn_date
 * @property string|null $trxn_desc
 * @property float $amount
 * @property string $trxn_type
 * @property float|null $balance
 * @property \Cake\I18n\Date $created
 * @property \Cake\I18n\Date $modified
 * @property string $ssms_client_code
 */
class SsmsBalancesheet extends Entity
{
    /**
     * Fields that can be mass assigned using newEntity() or patchEntity().
     *
     * Note that when '*' is set to true, this allows all unspecified fields to
     * be mass assigned. For security purposes, it is advised to set '*' to false
     * (or remove it), and explicitly make individual fields accessible as needed.
     *
     * @var array<string, bool>
     */
    protected array $_accessible = [
        'trxn_date' => true,
        'trxn_desc' => true,
        'amount' => true,
        'trxn_type' => true,
        'balance' => true,
        'created' => true,
        'modified' => true,
        'ssms_client_code' => true,
    ];
}
