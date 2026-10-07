<?php
declare(strict_types=1);

namespace App\Model\Entity;

use Cake\ORM\Entity;

/**
 * SsmsMark Entity
 *
 * @property int $id
 * @property int $branch_id
 * @property int $exam_id
 * @property int $session_id
 * @property int $class_id
 * @property int $section_id
 * @property int $subject_id
 * @property string $enrollment_id
 * @property float|null $theory_marks
 * @property string|null $roll_number
 * @property float|null $internal_marks
 * @property float|null $practical_marks
 * @property float|null $total_marks
 * @property \Cake\I18n\DateTime $created
 * @property \Cake\I18n\DateTime|null $modified
 * @property string $ssms_client_code
 *
 * @property \App\Model\Entity\SsmsBranch $branch
 */
class SsmsMark extends Entity
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
        'branch_id' => true,
        'exam_id' => true,
        'session_id' => true,
        'class_id' => true,
        'section_id' => true,
        'subject_id' => true,
        'enrollment_id' => true,
        'theory_marks' => true,
        'roll_number' => true,
        'internal_marks' => true,
        'practical_marks' => true,
        'total_marks' => true,
        'created' => true,
        'modified' => true,
        'ssms_client_code' => true,
        'branch' => true,
    ];
}
