<?php
namespace App\Model\Entity;

use Cake\ORM\Entity;

class SsmsRoomSeat extends Entity
{
    protected array $_accessible = [
		'seat_number' => true,
        'room_id' => true,
        'building_id' => true,
        'ssms_client_code' => true,
		'status' => true
    ];
    
}
