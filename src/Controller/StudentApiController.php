<?php
declare(strict_types=1);

namespace App\Controller;
use Cake\Datasource\ConnectionManager; 
use Cake\I18n\Date;
use Cake\Routing\Router;
use Cake\Filesystem\Folder;
use Psr\Http\Message\UploadedFileInterface;
use Authentication\Middleware\AuthenticationMiddleware;
use Cake\Http\Exception\BadRequestException;
use Cake\Utility\Text;
use Cake\Database\Expression\QueryExpression;
use Cake\Log\Log;
use Cake\I18n\DateTime;
use Cake\Mailer\Mailer;


/**
 * SaweraSsmsUsers Controller
 *
 * @property \App\Model\Table\SaweraSsmsUsersTable $SaweraSsmsUsers
 *
 * SQL migration — run once:
 *   ALTER TABLE ssms_student_registration
 *     ADD COLUMN blood_group VARCHAR(10) DEFAULT NULL
 *     AFTER religion;
 */
class StudentApiController extends AppController
{
	 public function initialize(): void
    {
        parent::initialize();
        $this->viewBuilder()->setClassName('Json');
		  // Allow login without authentication
    	//$this->Authentication->allowUnauthenticated(['login','getClasses','getSessions','getBranches','registerStudent','getRegisteredStudens', 'students', 'getSections', 'enrollStudent',
       //                                             'getEnrolledStudents','fetchStudentByRegId','updateStudent']);
    }

	public function getClasses()
	{ 
	$this->request->allowMethod(['get']);

    $ssmsClientCode = $this->request->getAttribute('jwt_client_code');
	//$ssmsClientCode = $this->request->getHeaderLine('ssmsClientCode');
    $classTable = $this->fetchTable('SsmsClasses');
    $classes = $classTable->find()
        ->select(['class_id', 'class_name']) 
        ->where(['ssms_client_code' => $ssmsClientCode])
        ->all();
		 if ($classes->count() >0 ) {
					$response = [
						'status' => true,
            			'data' => $classes
					];
			} 
		else {
				$response = [
					'status' => false,
					'message' => 'No class found'				];
			}
		// Force JSON response
		//print_r($response);
    	$this->response = $this->response->withType('application/json')
                                     ->withStringBody(json_encode($response));
		
    		return $this->response;

	}


	
	public function getBranches()
	{ 
		$this->request->allowMethod(['get']);
        $ssmsClientCode = $this->request->getAttribute('jwt_client_code');
        $ssmsUserRole   = $this->request->getAttribute('jwt_role');
        $ssmsUserName  = $this->request->getAttribute('jwt_user');
		//$ssmsUserName = $this->request->getHeaderLine('ssmsUserName');
		//$ssmsUserRole = $this->request->getHeaderLine('ssmsUserRole');
		//$ssmsClientCode = $this->request->getHeaderLine('ssmsClientCode');
		$branchTable = $this->fetchTable('SsmsBranch');
		$branch = $branchTable->find()
		->select(['branch_id', 'branch_name'])
        ->where(['ssms_client_code' => $ssmsClientCode])
		->all();
		 if ($branch->count() >0 ) {
					$response = [
						'status' => true,
            			'data' => $branch
					];
			} 
		else {
				$response = [
					'status' => false,
					'message' => 'No class found'				];
			}
		// Force JSON response
		//print_r($response);
    	$this->response = $this->response->withType('application/json')
                                     ->withStringBody(json_encode($response));
		
    return $this->response;

	}
	
	public function getSessions()
	{ 
		$this->request->allowMethod(['get']);
		$ssmsUserName = $this->request->getHeaderLine('ssmsUserName');
		$ssmsUserRole = $this->request->getHeaderLine('ssmsUserRole');
		$ssmsClientCode = $this->request->getHeaderLine('ssmsClientCode');
		$sessionTable = $this->fetchTable('SsmsSessions');
		$sessions = $sessionTable->find()
		->select(['session_id', 'session_name', 'is_current', 'active'])
        ->where(['ssms_client_code' => $ssmsClientCode])
		->all();
		 if ($sessions->count() >0 ) {
					$response = [
						'status' => true,
            			'data' => $sessions
					];
			} 
		else {
				$response = [
					'status' => false,
					'message' => 'No class found'				];
			}
		// Force JSON response
    	$this->response = $this->response->withType('application/json')
                                     ->withStringBody(json_encode($response));
		
    	return $this->response;

	}
    
    public function getACurrentSession($ssmsClientCode)
	{ 
		//$this->request->allowMethod(['get']);
		//$ssmsUserName = $this->request->getHeaderLine('ssmsUserName');
		//$ssmsUserRole = $this->request->getHeaderLine('ssmsUserRole');
		$ssmsClientCode = $this->request->getHeaderLine('ssmsClientCode');
		$sessionTable = $this->fetchTable('SsmsSessions');
		$session = $this->fetchTable('SsmsSessions')
            ->find()
            ->select(['session_id']) // Only select what you need
            ->where([
                'ssms_client_code' => $ssmsClientCode,
                'is_current' => 'Y'
            ])
            ->first(); // Returns entity or null

        // 2. Safely return the ID
            if ($session) {
                return $session->session_id;
            }

            return null;

	}
    
    public function getSections()
	{ 
		$this->request->allowMethod(['get']);

        $ssmsClientCode = $this->request->getHeaderLine('ssmsClientCode');
        $classId = $this->request->getQuery('classId');

        if (empty($classId)) {
            $response = [
                'status' => false,
                'message' => 'Class ID is required',
                'data' => []
            ];

            return $this->response
                ->withType('application/json')
                ->withStatus(400)
                ->withStringBody(json_encode($response));
        }

        $SectionTable = $this->fetchTable('SsmsSections');

        $sections = $SectionTable->find()
            ->select(['section_id', 'section_name'])
            ->where([
                'ssms_client_code' => $ssmsClientCode,
                'class_id' => $classId
            ])
            ->orderAsc('section_name')
            ->all()
            ->toList();

        $response = [
            'status' => true,
            'data' => $sections
        ];

        return $this->response
            ->withType('application/json')
            ->withStringBody(json_encode($response));

	}
	
	public function getRegisteredStudens()
	{ 
		$this->request->allowMethod(['get']);
		$ssmsUserName = $this->request->getHeaderLine('ssmsUserName');
		$ssmsUserRole = $this->request->getHeaderLine('ssmsUserRole');
		$ssmsClientCode = $this->request->getHeaderLine('ssmsClientCode');
		$studentTable = $this->fetchTable('SsmsStudentRegistration');
		$registeredStudents = $studentTable->find()
		->select([
            'registrationNo' => 'SsmsStudentRegistration.registration_id',
            'firstName' => 'SsmsStudentRegistration.student_first_name',
            'middleName' => 'SsmsStudentRegistration.student_middle_name',
			'lastName' => 'SsmsStudentRegistration.student_last_name',
			'emailAddress' => 'SsmsStudentRegistration.email_address',
			'gender' => 'SsmsStudentRegistration.student_gender',
			'dob' => 'SsmsStudentRegistration.student_dob',
            'classId' => 'SsmsStudentRegistration.class_id',
            'branchId' => 'SsmsStudentRegistration.branch_id',
			'sessionIdId' => 'SsmsStudentRegistration.session_id',
            'mobileNumber' => 'SsmsStudentRegistration.mobile_number',
            'photo' => 'SsmsStudentRegistration.student_photo',
            'className' => 'SsmsClasses.class_name',
			'placeOfBirth' => 'SsmsStudentRegistration.student_birth_place',
			'nationality' => 'SsmsStudentRegistration.student_nationality',
			'courseMedium' => 'SsmsStudentRegistration.course_medium',
			'isPhysicallyChallenged' => 'SsmsStudentRegistration.student_physically_challenged',
			'admissionType' => 'SsmsStudentRegistration.student_admission_type',
			'cAddressLine1' => 'SsmsStudentRegistration.student_c_address_line_1',
			'cAddressLine2' => 'SsmsStudentRegistration.student_c_address_line_2',
			'cAddressCity' => 'SsmsStudentRegistration.student_c_address_city',
			'cAddressState' => 'SsmsStudentRegistration.student_c_address_state',
			'cAddressZipCode' => 'SsmsStudentRegistration.student_c_address_zip',
			'pAddressLine1' => 'SsmsStudentRegistration.student_p_address_line_1',
			'pAddressLine2' => 'SsmsStudentRegistration.student_p_address_line_2',
			'pAddressCity' => 'SsmsStudentRegistration.student_p_address_city',
			'pAddressState' => 'SsmsStudentRegistration.student_p_address_state',
			'pAddressZipCode' => 'SsmsStudentRegistration.student_p_address_zip',
			'pAddressLine1' => 'SsmsStudentRegistration.student_father_name',
			'pAddressLine2' => 'SsmsStudentRegistration.father_qualification',
			'pAddressCity' => 'SsmsStudentRegistration.father_age',
			'pAddressState' => 'SsmsStudentRegistration.father_occupation',
			'pAddressZipCode' => 'SsmsStudentRegistration.student_mother_name',
			'pAddressLine2' => 'SsmsStudentRegistration.mother_qualification',
			'pAddressCity' => 'SsmsStudentRegistration.mother_age',
			'pAddressState' => 'SsmsStudentRegistration.mother_occupation',
        ])
        ->innerJoinWith('SsmsClasses')
        ->where(['SsmsStudentRegistration.ssms_client_code' => $ssmsClientCode, 'SsmsStudentRegistration.enroll_status'=>'pending'])
		->all();
		 if ($registeredStudents->count() >0 ) {
					$response = [
						'status' => true,
            			'data' => $registeredStudents
					];
			} 
		else {
				$response = [
					'status' => false,
					'message' => 'No class found'				];
			}
		// Force JSON response
    	$this->response = $this->response->withType('application/json')
                                     ->withStringBody(json_encode($response));
		
    	return $this->response;

	}
	
    public function getEnrolledStudents()
    {
        $this->request->allowMethod(['get']);

        $ssmsClientCode = $this->request->getAttribute('jwt_client_code')
                       ?? $this->request->getHeaderLine('ssmsClientCode');

        // Filters from query string
        $classId   = $this->request->getQuery('classId');
        $sectionId = $this->request->getQuery('sectionId');
        $branchId  = $this->request->getQuery('branchId');
        $sessionId = $this->request->getQuery('sessionId');
        $search    = trim((string)($this->request->getQuery('search') ?? ''));
        $page      = max(1, (int)($this->request->getQuery('page')  ?? 1));
        $limit     = max(1, min(100, (int)($this->request->getQuery('limit') ?? 20)));

        $studentEnrollmentTable = $this->fetchTable('SsmsStudentEnrollment');

        $query = $studentEnrollmentTable->find()
            ->select([
                'registrationNo'         => 'SsmsStudentRegistration.registration_id',
                'firstName'              => 'SsmsStudentRegistration.student_first_name',
                'middleName'             => 'SsmsStudentRegistration.student_middle_name',
                'lastName'               => 'SsmsStudentRegistration.student_last_name',
                'emailAddress'           => 'SsmsStudentRegistration.email_address',
                'gender'                 => 'SsmsStudentRegistration.student_gender',
                'dob'                    => 'SsmsStudentRegistration.student_dob',
                'classId'                => 'SsmsStudentEnrollment.class_id',
                'branchId'               => 'SsmsStudentEnrollment.branch_id',
                'sessionId'              => 'SsmsStudentEnrollment.session_id',
                'sectionId'              => 'SsmsStudentEnrollment.section_id',
                'section'                => 'SsmsSection.section_name',
                'mobileNumber'           => 'SsmsStudentRegistration.mobile_number',
                'photo'                  => 'SsmsStudentRegistration.student_photo',
                'className'              => 'SsmsClasses.class_name',
                'branchName'             => 'SsmsBranch.branch_name',
                'sessionName'            => 'SsmsSessions.session_name',
                'placeOfBirth'           => 'SsmsStudentRegistration.student_birth_place',
                'nationality'            => 'SsmsStudentRegistration.student_nationality',
                'courseMedium'           => 'SsmsStudentRegistration.course_medium',
                'isPhysicallyChallenged' => 'SsmsStudentRegistration.student_physically_challenged',
                'admissionType'          => 'SsmsStudentRegistration.student_admission_type',
                'cAddressLine1'          => 'SsmsStudentRegistration.student_c_address_line_1',
                'cAddressLine2'          => 'SsmsStudentRegistration.student_c_address_line_2',
                'cAddressCity'           => 'SsmsStudentRegistration.student_c_address_city',
                'cAddressState'          => 'SsmsStudentRegistration.student_c_address_state',
                'cAddressZipCode'        => 'SsmsStudentRegistration.student_c_address_zip',
                'pAddressLine1'          => 'SsmsStudentRegistration.student_p_address_line_1',
                'pAddressLine2'          => 'SsmsStudentRegistration.student_p_address_line_2',
                'pAddressCity'           => 'SsmsStudentRegistration.student_p_address_city',
                'pAddressState'          => 'SsmsStudentRegistration.student_p_address_state',
                'pAddressZipCode'        => 'SsmsStudentRegistration.student_p_address_zip',
                'fatherName'             => 'SsmsStudentRegistration.student_father_name',
                'fatherQualification'    => 'SsmsStudentRegistration.father_qualification',
                'fatherOccupation'       => 'SsmsStudentRegistration.father_occupation',
                'motherName'             => 'SsmsStudentRegistration.student_mother_name',
                'motherOccupation'       => 'SsmsStudentRegistration.mother_occupation',
                'enrollmentId'           => 'SsmsStudentEnrollment.enrollment_id',
                'rollNumber'             => 'SsmsStudentEnrollment.roll_number',
                'enrollmentStatus'       => 'SsmsStudentEnrollment.status',
                'ssmsClientCode'         => 'SsmsStudentEnrollment.ssms_client_code',
                'admissionNumber'        => 'SsmsStudentRegistration.admission_number',
            ])
            ->innerJoin(
                ['SsmsStudentRegistration' => 'ssms_student_registration'],
                ['SsmsStudentRegistration.registration_id = SsmsStudentEnrollment.registration_id']
            )
            ->leftJoin(
                ['SsmsClasses' => 'ssms_classes'],
                ['SsmsClasses.class_id = SsmsStudentEnrollment.class_id']
            )
            ->leftJoin(
                ['SsmsSection' => 'ssms_sections'],
                ['SsmsSection.section_id = SsmsStudentEnrollment.section_id']
            )
            ->leftJoin(
                ['SsmsBranch' => 'ssms_branch'],
                ['SsmsBranch.branch_id = SsmsStudentEnrollment.branch_id']
            )
            ->leftJoin(
                ['SsmsSessions' => 'ssms_sessions'],
                ['SsmsSessions.session_id = SsmsStudentEnrollment.session_id']
            )
            ->where([
                'SsmsStudentEnrollment.ssms_client_code'  => $ssmsClientCode,
                'SsmsStudentRegistration.ssms_client_code' => $ssmsClientCode,
                'SsmsStudentRegistration.enroll_status'   => 'enrolled',
                'SsmsStudentEnrollment.status'            => 'active',
            ])
            ->enableHydration(false)
            ->orderAsc('SsmsStudentRegistration.student_first_name');

        // Apply filters
        if (!empty($classId))   $query->where(['SsmsStudentEnrollment.class_id'   => $classId]);
        if (!empty($sectionId)) $query->where(['SsmsStudentEnrollment.section_id' => $sectionId]);
        if (!empty($branchId))  $query->where(['SsmsStudentEnrollment.branch_id'  => $branchId]);
        if (!empty($sessionId)) $query->where(['SsmsStudentEnrollment.session_id' => $sessionId]);
        if ($search !== '') {
            $query->where(function ($exp) use ($search) {
                return $exp->or([
                    'SsmsStudentRegistration.student_first_name LIKE'  => "%{$search}%",
                    'SsmsStudentRegistration.student_last_name LIKE'   => "%{$search}%",
                    'SsmsStudentEnrollment.enrollment_id LIKE'         => "%{$search}%",
                    'SsmsStudentRegistration.mobile_number LIKE'       => "%{$search}%",
                ]);
            });
        }

        // Pagination
        $total      = (clone $query)->count();
        $offset     = ($page - 1) * $limit;
        $students   = $query->limit($limit)->offset($offset)->toArray();
        $totalPages = (int)ceil($total / $limit);

        return $this->response
            ->withType('application/json')
            ->withStringBody(json_encode([
                'status' => true,
                'data'   => $students,
                'pagination' => [
                    'page'        => $page,
                    'limit'       => $limit,
                    'total'       => $total,
                    'totalPages'  => $totalPages,
                    'hasNextPage' => $page < $totalPages,
                ],
            ]));
    }
    
public function students()
{
    $this->request->allowMethod(['get']);

    $Students = $this->fetchTable('SsmsStudentRegistration');
		$ssmsUserName = $this->request->getHeaderLine('ssmsUserName');
		$ssmsUserRole = $this->request->getHeaderLine('ssmsUserRole');
		$ssmsClientCode = $this->request->getHeaderLine('ssmsClientCode');
        $search = trim((string)$this->request->getQuery('search', ''));
        $page = max(1, (int)$this->request->getQuery('page', 1));
        $limit = max(1, min(100, (int)$this->request->getQuery('limit', 20)));
        $classId = $this->request->getQuery('classId');
        $section = trim((string)$this->request->getQuery('section', ''));
        $query = $Students->find()
            ->select([
            'registrationNo' => 'SsmsStudentRegistration.registration_id',
            'firstName' => 'SsmsStudentRegistration.student_first_name',
            'middleName' => 'SsmsStudentRegistration.student_middle_name',
			'lastName' => 'SsmsStudentRegistration.student_last_name',
			'emailAddress' => 'SsmsStudentRegistration.email_address',
			'gender' => 'SsmsStudentRegistration.student_gender',
			'dob' => 'SsmsStudentRegistration.student_dob',
            'classId' => 'SsmsStudentRegistration.class_id',
            'branchId' => 'SsmsStudentRegistration.branch_id',
			'sessionIdId' => 'SsmsStudentRegistration.session_id',
            'mobileNumber' => 'SsmsStudentRegistration.mobile_number',
            'photo' => 'SsmsStudentRegistration.student_photo',
            'className' => 'SsmsClasses.class_name',
			'placeOfBirth' => 'SsmsStudentRegistration.student_birth_place',
			'nationality' => 'SsmsStudentRegistration.student_nationality',
			'courseMedium' => 'SsmsStudentRegistration.course_medium',
			'isPhysicallyChallenged' => 'SsmsStudentRegistration.student_physically_challenged',
			'admissionType' => 'SsmsStudentRegistration.student_admission_type',
			'cAddressLine1' => 'SsmsStudentRegistration.student_c_address_line_1',
			'cAddressLine2' => 'SsmsStudentRegistration.student_c_address_line_2',
			'cAddressCity' => 'SsmsStudentRegistration.student_c_address_city',
			'cAddressState' => 'SsmsStudentRegistration.student_c_address_state',
			'cAddressZipCode' => 'SsmsStudentRegistration.student_c_address_zip',
			'pAddressLine1' => 'SsmsStudentRegistration.student_p_address_line_1',
			'pAddressLine2' => 'SsmsStudentRegistration.student_p_address_line_2',
			'pAddressCity' => 'SsmsStudentRegistration.student_p_address_city',
			'pAddressState' => 'SsmsStudentRegistration.student_p_address_state',
			'pAddressZipCode' => 'SsmsStudentRegistration.student_p_address_zip',
			'pAddressLine1' => 'SsmsStudentRegistration.student_father_name',
			'pAddressLine2' => 'SsmsStudentRegistration.father_qualification',
			'pAddressCity' => 'SsmsStudentRegistration.father_age',
			'pAddressState' => 'SsmsStudentRegistration.father_occupation',
			'pAddressZipCode' => 'SsmsStudentRegistration.student_mother_name',
			'pAddressLine2' => 'SsmsStudentRegistration.mother_qualification',
			'pAddressCity' => 'SsmsStudentRegistration.mother_age',
			'pAddressState' => 'SsmsStudentRegistration.mother_occupation',
        ])
        ->innerJoinWith('SsmsClasses')
        ->where(['SsmsStudentRegistration.ssms_client_code' => $ssmsClientCode, 'SsmsStudentRegistration.enroll_status'=>'pending']);

    if ($classId !== null && $classId !== '') {
        $query->where(['SsmsStudentRegistration.class_id' => $classId]);
    }
//
//    if ($section !== '') {
//        $query->where(['SsmsStudentRegistration.section' => $section]);
//    }

    if ($search !== '') {
        $query->where(function (QueryExpression $exp) use ($search) {
            return $exp->or([
                'SsmsStudentRegistration.student_first_name LIKE' => "%{$search}%",
                'SsmsStudentRegistration.student_last_name LIKE' => "%{$search}%",
                'SsmsStudentRegistration.registration_number LIKE' => "%{$search}%",
                'SsmsStudentRegistration.mobile_number LIKE' => "%{$search}%",
                'SsmsClasses.class_name LIKE' => "%{$search}%",
            ]);
        });
    }

    $total = $query->count();

    $students = $query
        ->orderDesc('SsmsStudentRegistration.registration_id')
        ->limit($limit)
        ->offset(($page - 1) * $limit)
        ->enableHydration(false)
        ->toArray();

    $response = [
        'status' => true,
        'students' => $students,
        'pagination' => [
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'totalPages' => (int)ceil($total / $limit),
            'hasNextPage' => ($page * $limit) < $total,
            'hasPrevPage' => $page > 1,
        ],
        'filters' => [
            'search' => $search,
            'classId' => $classId,
            'section' => $section,
        ],
    ];

    return $this->response
        ->withType('application/json')
        ->withStringBody(json_encode($response));
}
	
	public function registerStudent()
    {
         $this->request->allowMethod(['post']);
        $ssmsClientCode = $this->request->getHeaderLine('ssmsClientCode');
        $data = $this->request->getData();
        $file = $this->request->getUploadedFile('student_photo');
        Log::error('$data from form : '.json_encode($data)); 
        // ── 1. Validate required fields ──────────────────────────────────────
        $errors = $this->validateStudentData($data);
        if (!empty($errors)) {
            $this->response = $this->response->withStatus(422);
            $this->set(['success' => false, 'message' => 'Validation failed.', 'errors' => $errors]);
            $this->viewBuilder()->setOption('serialize', ['success', 'message', 'errors']);
            return;
        }
        $RegistrationNum = $this->generateRegistrationNumber($ssmsClientCode); 
        // ── 2. Handle photo upload ────────────────────────────────────────────
        $photoFilename = null;
 
        if ($file !== null && $file->getError() === UPLOAD_ERR_OK) {
            $uploadResult = $this->saveStudentPhoto($file, $data, $RegistrationNum, $ssmsClientCode);
 
            if (!$uploadResult['success']) {
                $this->response = $this->response->withStatus(422);
                $this->set(['success' => false, 'message' => $uploadResult['message']]);
                $this->viewBuilder()->setOption('serialize', ['success', 'message']);
                return;
            }
 
            $photoFilename = $uploadResult['filename'];
        }
 
        // ── 3. Build and save student entity ─────────────────────────────────
        $table  = $this->getTableLocator()->get('SsmsStudentRegistration');
        $entity = $table->newEntity(
            $this->sanitizeStudentData($data, $photoFilename, $RegistrationNum,$ssmsClientCode),
            ['accessibleFields' => ['*' => true]]
        );
         Log::error('$entity after sanitize: '.json_encode($entity)); 

        if (!$table->save($entity)) {
            // If save fails but photo was already written, clean it up
          Log::error('save failed: '.json_encode($entity)); 

            if ($photoFilename) {
                $this->deletePhotoFile($photoFilename);
            }
 
            Log::error('StudentsController::register() save failed: ' . json_encode($entity->getErrors()));
            $this->response = $this->response->withStatus(500);
            $this->set([
                'success' => false,
                'message' => 'Failed to save student record.',
                'errors'  => $entity->getErrors(),
            ]);
            $this->viewBuilder()->setOption('serialize', ['success', 'message', 'errors']);
            return;
        }
 
        // ── 4. Send confirmation email (non-fatal) ───────────────────────────
        $emailAddress = strtolower(trim((string)($data['emailAddress'] ?? $data['email_address'] ?? '')));
        $emailSent    = false;
        if ($emailAddress !== '') {
            $studentName = trim(
                ($data['firstName'] ?? $data['first_name'] ?? '') . ' ' .
                ($data['lastName']  ?? $data['last_name']  ?? '')
            ) ?: trim($data['firstName'] ?? $data['first_name'] ?? 'Student');

            $emailSent = $this->sendRegistrationConfirmEmail(
                email:       $emailAddress,
                studentName: $studentName,
                regId:       (string)$entity->registration_id,
                clientCode:  $ssmsClientCode,
            );
        }

        // ── 5. Respond ────────────────────────────────────────────────────────
        $this->response = $this->response->withStatus(201);
        $this->set([
            'success'          => true,
            'message'          => 'Student registered successfully.',
            'student_id'       => $entity->student_id,
            'registration_no'  => $entity->registration_id,
            'student_photo'    => $photoFilename,
            'photo_url'        => $photoFilename ? '/' . $photoFilename : null,
            'email_sent'       => $emailSent,
            'email_address'    => $emailAddress ?: null,
        ]);
        $this->viewBuilder()->setOption('serialize', [
            'success', 'message', 'student_id', 'registration_no',
            'student_photo', 'photo_url', 'email_sent', 'email_address',
        ]);
    }

    // ── Registration confirmation email ───────────────────────────────────────
    private function sendRegistrationConfirmEmail(
        string $email,
        string $studentName,
        string $regId,
        string $clientCode
    ): bool {
        try {
            // Fetch school name
            $db  = $this->getTableLocator()->get('SsmsClients')->getConnection();
            $row = $db->execute(
                "SELECT ssms_client_name, ssms_client_header_text FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
                [$clientCode]
            )->fetchAssoc();
            $schoolName = trim($row['ssms_client_header_text'] ?? $row['ssms_client_name'] ?? 'School');

            $mailer = new Mailer('default');
            $mailer
                ->setEmailFormat('html')
                ->setTo($email, $studentName)
                ->setFrom(
                    env('MAIL_FROM_ADDRESS', 'admin@managemyacademy.com'),
                    $schoolName
                )
                ->setSubject("Registration Confirmed — {$schoolName}");

            $mailer->viewBuilder()
                ->setTemplate('student_registration_confirm');

            $mailer->setViewVars([
                'schoolName'  => $schoolName,
                'studentName' => $studentName,
                'regId'       => $regId,
            ]);

            $mailer->send();
            return true;
        } catch (\Exception $e) {
            Log::error('sendRegistrationConfirmEmail failed: ' . $e->getMessage());
            return false;
        }
    }

     private function sanitizeStudentData(array $d, ?string $photoFilename,$RegistrationNum, $ssmsClientCode): array
    {
        $now = DateTime::now()->toDateString();
        return [
            'registration_id'         => $RegistrationNum,
            'student_title'                   => trim((string)($d['title']              ?? '')),
            'student_first_name'              => trim((string)($d['firstName']          ?? $d['first_name']  ?? '')),
            'student_middle_name'             => trim((string)($d['middleName']         ?? $d['middle_name'] ?? '')),
            'student_last_name'               => trim((string)($d['lastName']           ?? $d['last_name']   ?? '')),
            'email_address'           => strtolower(trim((string)($d['emailAddress'] ?? $d['email_address'] ?? ''))),
            'mobile_number'           => trim((string)($d['mobileNumber']       ?? $d['mobile_number'] ?? '')),
            'student_gender'                  => trim((string)($d['gender']             ?? '')),
            'student_dob'                     => !empty((string)$d['dob']) ? $d['dob'] : null,
            'student_birth_place'          => trim((string)($d['placeOfBirth']       ?? $d['place_of_birth'] ?? '')),
            'student_nationality'             => trim((string)($d['nationality']        ?? '')),
            'class_id'                => !empty($d['classId']   ?? $d['class_id'])   ? (int)($d['classId']   ?? $d['class_id'])   : null,
            'branch_id'               => !empty($d['branchId']  ?? $d['branch_id'])  ? (int)($d['branchId']  ?? $d['branch_id'])  : null,
            'session_id'              => !empty($d['sessionId'] ?? $d['session_id']) ? (int)($d['sessionId'] ?? $d['session_id']) : null,
            'course_medium'           => trim((string)($d['courseMedium']       ?? $d['course_medium'] ?? '')),
            'student_physically_challenged'=> trim((string)($d['isPhysicallyChallenged'] ?? $d['is_physically_challenged'] ?? 'No')),
            'student_admission_type'          => trim((string)($d['admissionType']      ?? $d['admission_type'] ?? '')),
            'admission_number'                => trim((string)($d['admissionNumber']    ?? $d['admission_number'] ?? '')),
            'caste'                           => trim((string)($d['caste']              ?? '')),
            'religion'                        => trim((string)($d['religion']           ?? '')),
            'blood_group'                     => trim((string)($d['bloodGroup']         ?? $d['blood_group'] ?? '')),
            'student_father_name'             => trim((string)($d['fatherName']         ?? $d['father_name'] ?? '')),
            'father_qualification'        => trim((string)($d['fatherEducation']    ?? $d['father_education'] ?? '')),
            'father_age'              => !empty($d['fatherAge'] ?? $d['father_age'])  ? (int)($d['fatherAge'] ?? $d['father_age']) : null,
            'father_occupation'       => trim((string)($d['fatherOccupation']   ?? $d['father_occupation'] ?? '')),
            'student_mother_name'             => trim((string)($d['motherName']         ?? $d['mother_name'] ?? '')),
            'mother_qualification'        => trim((string)($d['motherEducation']    ?? $d['mother_education'] ?? '')),
            'mother_age'              => !empty($d['motherAge'] ?? $d['mother_age'])  ? (int)($d['motherAge'] ?? $d['mother_age']) : null,
            'mother_occupation'       => trim((string)($d['motherOccupation']   ?? $d['mother_occupation'] ?? '')),
            'student_photo'           => $photoFilename,    // exact same name as saved on disk
            'enroll_status'                  => 'pending',
             // Current address
            'student_c_address_line_1'     => trim((string)($d['cAddressLine1']    ?? $d['c_address_line1']    ?? '')),
            'student_c_address_line_2'     => trim((string)($d['cAddressLine2']    ?? $d['c_address_line2']    ?? '')),
            'student_c_address_city'      => trim((string)($d['cAddressCity']     ?? $d['c_address_city']     ?? '')),
            'student_c_address_state'     => trim((string)($d['cAddressState']    ?? $d['c_address_state']    ?? '')),
            'student_c_address_zip'  => trim((string)($d['cAddressZipCode']  ?? $d['c_address_zip_code'] ?? '')),
            'student_c_address_homephone' => trim((string)($d['cAddressHomephone']?? $d['c_address_homephone']?? '')),
            // Permanent address
            'student_p_address_line_1'     => trim((string)($d['pAddressLine1']    ?? $d['p_address_line1']    ?? '')),
            'student_p_address_line_2'     => trim((string)($d['pAddressLine2']    ?? $d['p_address_line2']    ?? '')),
            'student_p_address_city'      => trim((string)($d['pAddressCity']     ?? $d['p_address_city']     ?? '')),
            'student_p_address_state'     => trim((string)($d['pAddressState']    ?? $d['p_address_state']    ?? '')),
            'student_p_address_zip'  => trim((string)($d['pAddressZipCode']  ?? $d['p_address_zip_code'] ?? '')),
            'student_p_address_homephone' => trim((string)($d['pAddressHomephone']?? $d['p_address_homephone']?? '')),
            'student_photo'            => $photoFilename,
            'ssms_client_code' => $ssmsClientCode,

        ];
    }
    private function validateStudentData(array $d): array
    {
        $e = [];
        if (empty(trim((string)($d['firstName'] ?? $d['first_name'] ?? '')))) {
            $e['firstName']    = 'First name is required.';
        }

        if (empty(trim((string)($d['mobileNumber'] ?? $d['mobile_number'] ?? '')))) {
            $e['mobileNumber'] = 'Mobile number is required.';
        }
        if (empty($d['gender'])) {
            $e['gender']       = 'Gender is required.';
        }
        if (empty($d['classId']  ?? $d['class_id'])) {
            $e['classId']      = 'Class is required.';
        }
        if (empty($d['branchId'] ?? $d['branch_id'])) {
            $e['branchId']     = 'Branch is required.';
        }
        if (empty($d['sessionId'] ?? $d['session_id'])) {
            $e['sessionId']    = 'Session is required.';
        }
        if (!empty($d['emailAddress'] ?? $d['email_address'])) {
            $email = trim((string)($d['emailAddress'] ?? $d['email_address']));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $e['emailAddress'] = 'Please enter a valid email address.';
            }
        }
        return $e;
    }
    /**
     * Save uploaded student photo into webroot/uploads/students/
     * Returns relative path like: /uploads/students/CLIENTCODE/abc123.jpg
     */
   private function saveStudentPhoto($file, array $data, $RegistrationNum, $ssmsClientCode): array
    {
        // ── Validate MIME type ────────────────────────────────────────────────
        $allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        $mime         = $file->getClientMediaType();
 
        if (!in_array($mime, $allowedMimes, true)) {
            return ['success' => false, 'filename' => null, 'message' => "Invalid file type '{$mime}'. Only JPEG, PNG and WebP are allowed."];
        }
 
        // ── Validate file size (max 5 MB) ────────────────────────────────────
        $maxBytes = 5 * 1024 * 1024;
        if ($file->getSize() > $maxBytes) {
            $mb = round($file->getSize() / 1024 / 1024, 1);
            return ['success' => false, 'filename' => null, 'message' => "Photo is too large ({$mb} MB). Maximum allowed size is 5 MB."];
        }
 
        // ── Build filename from student's name ────────────────────────────────
        $firstName  = trim((string)($data['firstName']  ?? $data['first_name']  ?? ''));
        $middleName = trim((string)($data['middleName'] ?? $data['middle_name'] ?? ''));
        $lastName   = trim((string)($data['lastName']   ?? $data['last_name']   ?? ''));
 
        $fullName   = implode('_', array_filter([$firstName, $middleName ? substr($middleName, 0, 1) : '', $lastName]));
        $safeName   = $this->sanitizeFilename($fullName);
 
        if (empty($safeName)) {
            $safeName = $RegistrationNum;   // fallback if name fields are all empty
        }
 
        $timestamp = date('Ymd_Hi');
        $unique    = substr(uniqid('', false), -5);
        $extension = in_array($mime, ['image/png'], true) ? 'png' : 'jpg';
 
        $filename  = "{$safeName}_{$timestamp}_{$unique}.{$extension}";
 
        // ── Ensure upload directory exists ────────────────────────────────────
       // $uploadDir = WWW_ROOT . str_replace('/', DS, self::PHOTO_DIR);
        $uploadDir = "../../clients/" .$ssmsClientCode. "/Students/" . $RegistrationNum ."/";
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }
 
        // ── Move file to its permanent location ───────────────────────────────
        $destination = $uploadDir . DS . $filename;
 
        try {
            $file->moveTo($destination);
        } catch (\Exception $e) {
            Log::error('StudentsController::saveStudentPhoto() moveTo failed: ' . $e->getMessage());
            return ['success' => false, 'filename' => null, 'message' => 'Could not save photo file: ' . $e->getMessage()];
        }
 
        Log::info("Student photo saved: {$filename}");
 
        return ['success' => true, 'filename' => $filename, 'message' => ''];
    }
	
    private function deletePhotoFile(string $filename): void
    {
        $path = "../../clients/" ."TWF/Students/" . $RegistrationNum ."/".$filename;
        if (file_exists($path)) {
            unlink($path);
            Log::info("Student photo deleted: {$filename}");
        }
    }
     private function sanitizeFilename(string $name): string
    {
        $lower   = mb_strtolower($name, 'UTF-8');
        $ascii   = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $lower);
        $clean   = preg_replace('/[^a-z0-9]+/', '_', $ascii ?? $lower);
        return trim($clean, '_');
    }
    
	public function generateRegistrationNumber($client_code)
        {
          //$ssmsClients = $this->loadModel('SsmsClients');
		  $studentTable = $this->fetchTable('SsmsStudentRegistration');
          $session = $this->request->getSession();
          //$RegPreFix = $this->SsmsClients->find('all', array('fields' => array('registration_prefix'), 'conditions' => array('ssms_client_code'=>$session->read('ssms_client_code')), 'group by' => 'registration_prefix'));
//         foreach($RegPreFix as $row)
//             {
//              $prefix = $row->registration_prefix;
//             }
         $Year = date("Y");
        // dump($session->read('ssms_client_code'));
         $lastRegNumber = $studentTable->find()
             ->select(['registration_id'])
             ->where(['ssms_client_code' => $client_code])
             ->orderByDesc('registration_id')
             ->limit(1);
		//dump($client_code);
		foreach($lastRegNumber as $row)
           {
            $current_reg_number = $row->registration_id;
          }
		 // var_dump($current_reg_number);
          if($current_reg_number != null || !empty($current_reg_number))
         { 
             $pieces = explode("-", $current_reg_number);
              $lastSessionYear = $pieces[1] ?? null;
			  $lastNum = $pieces[2] ?? "0";
			 if($Year === $lastSessionYear) 
 				$thirdPart = str_pad((string)((int)$lastNum + 1), 4, '0', STR_PAD_LEFT);			  
			  else
				$thirdPart = str_pad('1', 4, '0', STR_PAD_LEFT);  
			 // dump("R".$client_code . "-" . $Year . "-" . $thirdPart);
             return "R".$client_code . "-" . $Year . "-" . $thirdPart;
       
             }
            else {
               return "R".$client_code . "-" . $Year . "-" . "0001";
            }
        
    }
	
	public function fetchStudentByRegId($id)
	{
		$this->request->allowMethod(['get']);

		$ssmsClientCode = $this->request->getAttribute('jwt_client_code')
					   ?? $this->request->getHeaderLine('ssmsClientCode');

		// ── 1. Fetch all columns from registration table ──────────────────────
		$regTable = $this->fetchTable('SsmsStudentRegistration');
		$raw = $regTable->find()
			->where(['registration_id' => $id])
			->enableHydration(false)
			->first();

		if (!$raw) {
			return $this->response
				->withType('application/json')
				->withStringBody(json_encode(['status' => false, 'message' => 'Student not found']));
		}

		// ── 2. Fetch active enrollment + class/section/branch/session names ───
		$enrollTable = $this->fetchTable('SsmsStudentEnrollment');
		$enr = $enrollTable->find()
			->select([
				'classId'     => 'SsmsStudentEnrollment.class_id',
				'branchId'    => 'SsmsStudentEnrollment.branch_id',
				'sessionId'   => 'SsmsStudentEnrollment.session_id',
				'sectionId'   => 'SsmsStudentEnrollment.section_id',
				'enrollmentId'=> 'SsmsStudentEnrollment.enrollment_id',
				'rollNumber'  => 'SsmsStudentEnrollment.roll_number',
				'section'     => 'SsmsSection.section_name',
				'className'   => 'SsmsClasses.class_name',
				'branchName'  => 'SsmsBranch.branch_name',
				'sessionName' => 'SsmsSessions.session_name',
			])
			->leftJoin(['SsmsClasses'  => 'ssms_classes'],  ['SsmsClasses.class_id    = SsmsStudentEnrollment.class_id'])
			->leftJoin(['SsmsSection'  => 'ssms_sections'], ['SsmsSection.section_id  = SsmsStudentEnrollment.section_id'])
			->leftJoin(['SsmsBranch'   => 'ssms_branch'],   ['SsmsBranch.branch_id    = SsmsStudentEnrollment.branch_id'])
			->leftJoin(['SsmsSessions' => 'ssms_sessions'], ['SsmsSessions.session_id = SsmsStudentEnrollment.session_id'])
			->where([
				'SsmsStudentEnrollment.registration_id'  => $id,
				'SsmsStudentEnrollment.ssms_client_code' => $ssmsClientCode,
				'SsmsStudentEnrollment.status'           => 'active',
			])
			->enableHydration(false)
			->first();

		// ── 3. Build complete camelCase response ──────────────────────────────
		$student = [
			// Identity
			'registrationNo'         => $raw['registration_id'],
			'title'                  => $raw['student_title']                  ?? '',
			'firstName'              => $raw['student_first_name']             ?? '',
			'middleName'             => $raw['student_middle_name']            ?? '',
			'lastName'               => $raw['student_last_name']              ?? '',
			'emailAddress'           => $raw['email_address']                  ?? '',
			'mobileNumber'           => $raw['mobile_number']                  ?? '',
			'gender'                 => $raw['student_gender']                 ?? '',
			'dob'                    => isset($raw['student_dob']) ? (is_object($raw['student_dob']) ? $raw['student_dob']->format('Y-m-d') : substr((string)$raw['student_dob'], 0, 10)) : '',
			'placeOfBirth'           => $raw['student_birth_place']            ?? '',
			'nationality'            => $raw['student_nationality']            ?? '',
			'courseMedium'           => $raw['course_medium']                  ?? '',
			'admissionType'          => $raw['student_admission_type']         ?? '',
			'isPhysicallyChallenged' => $raw['student_physically_challenged']  ?? '',
			'admissionNumber'        => $raw['admission_number']               ?? '',
			'caste'                  => $raw['caste']                          ?? '',
			'religion'               => $raw['religion']                       ?? '',
			'bloodGroup'             => $raw['blood_group']                    ?? '',
			'photo'                  => $raw['student_photo']                  ?? '',
			'enrollStatus'           => $raw['enroll_status']                  ?? '',
			// Father
			'fatherName'             => $raw['student_father_name']            ?? '',
			'fatherQualification'    => $raw['father_qualification']           ?? '',
			'fatherAge'              => isset($raw['father_age']) ? (string)$raw['father_age'] : '',
			'fatherOccupation'       => $raw['father_occupation']              ?? '',
			// Mother
			'motherName'             => $raw['student_mother_name']            ?? '',
			'motherQualification'    => $raw['mother_qualification']           ?? '',
			'motherAge'              => isset($raw['mother_age']) ? (string)$raw['mother_age'] : '',
			'motherOccupation'       => $raw['mother_occupation']              ?? '',
			// Current address
			'cAddressLine1'          => $raw['student_c_address_line_1']       ?? '',
			'cAddressLine2'          => $raw['student_c_address_line_2']       ?? '',
			'cAddressCity'           => $raw['student_c_address_city']         ?? '',
			'cAddressState'          => $raw['student_c_address_state']        ?? '',
			'cAddressZipCode'        => $raw['student_c_address_zip']          ?? '',
			'cAddressHomephone'      => $raw['student_c_address_homephone']    ?? '',
			// Permanent address
			'pAddressLine1'          => $raw['student_p_address_line_1']       ?? '',
			'pAddressLine2'          => $raw['student_p_address_line_2']       ?? '',
			'pAddressCity'           => $raw['student_p_address_city']         ?? '',
			'pAddressState'          => $raw['student_p_address_state']        ?? '',
			'pAddressZipCode'        => $raw['student_p_address_zip']          ?? '',
			'pAddressHomephone'      => $raw['student_p_address_homephone']    ?? '',
			// Enrollment (null if not yet enrolled)
			'classId'                => $enr['classId']     ?? null,
			'branchId'               => $enr['branchId']    ?? null,
			'sessionId'              => $enr['sessionId']   ?? null,
			'sectionId'              => $enr['sectionId']   ?? null,
			'section'                => $enr['section']     ?? '',
			'className'              => $enr['className']   ?? '',
			'branchName'             => $enr['branchName']  ?? '',
			'sessionName'            => $enr['sessionName'] ?? '',
			'enrollmentId'           => $enr['enrollmentId']?? '',
			'rollNumber'             => $enr['rollNumber']  ?? '',
			'ssmsClientCode'         => $ssmsClientCode,
		];

		return $this->response
			->withType('application/json')
			->withStringBody(json_encode(['status' => true, 'student' => $student]));
	}

	public function updateStudent($id)
        {
            $this->request->allowMethod(['put', 'patch', 'post']);

            $ssmsClientCode = $this->request->getAttribute('jwt_client_code')
                           ?? $this->request->getHeaderLine('ssmsClientCode');

            Log::error("[updateStudent] id={$id} clientCode={$ssmsClientCode}");

            $Students = $this->fetchTable('SsmsStudentRegistration');

            // Find by registration_id (string like "RTWF-2024-0001"), not auto-increment student_id
            $student = $Students->find()
                ->where(['registration_id' => $id, 'ssms_client_code' => $ssmsClientCode])
                ->first();

            if (!$student) {
                return $this->response
                    ->withType('application/json')
                    ->withStringBody(json_encode(['status' => false, 'message' => 'Student not found']));
            }

            $d = $this->request->getData();

            // Map camelCase keys from app to snake_case DB column names
            $updateData = [];
            if (array_key_exists('firstName',   $d)) $updateData['student_first_name']          = trim((string)$d['firstName']);
            if (array_key_exists('lastName',    $d)) $updateData['student_last_name']            = trim((string)$d['lastName']);
            if (array_key_exists('emailAddress',$d)) $updateData['email_address']                = strtolower(trim((string)$d['emailAddress']));
            if (array_key_exists('mobileNumber',$d)) $updateData['mobile_number']                = trim((string)$d['mobileNumber']);
            if (array_key_exists('dob',         $d)) $updateData['student_dob']                  = !empty($d['dob']) ? substr(trim((string)$d['dob']), 0, 10) : null;
            if (array_key_exists('gender',      $d)) $updateData['student_gender']               = trim((string)$d['gender']);
            if (array_key_exists('fatherName',  $d)) $updateData['student_father_name']          = trim((string)$d['fatherName']);
            if (array_key_exists('placeOfBirth',$d)) $updateData['student_birth_place']          = trim((string)$d['placeOfBirth']);
            if (array_key_exists('nationality', $d)) $updateData['student_nationality']          = trim((string)$d['nationality']);
            if (array_key_exists('courseMedium',$d))    $updateData['course_medium']            = trim((string)$d['courseMedium']);
            if (array_key_exists('admissionType',$d))   $updateData['student_admission_type']   = trim((string)$d['admissionType']);
            if (array_key_exists('admissionNumber',$d)) $updateData['admission_number']         = trim((string)$d['admissionNumber']);
            if (array_key_exists('caste',$d))           $updateData['caste']                    = trim((string)$d['caste']);
            if (array_key_exists('religion',$d))        $updateData['religion']                 = trim((string)$d['religion']);
            if (array_key_exists('bloodGroup',$d))      $updateData['blood_group']              = trim((string)$d['bloodGroup']);
            if (array_key_exists('enrollStatus',$d)) {
                $allowed = ['pending', 'enrolled', 'cancelled'];
                $val = strtolower(trim((string)$d['enrollStatus']));
                if (in_array($val, $allowed, true)) $updateData['enroll_status'] = $val;
            }
            if (array_key_exists('fatherOccupation',$d)) $updateData['father_occupation']        = trim((string)$d['fatherOccupation']);
            if (array_key_exists('fatherQualification',$d)) $updateData['father_qualification']  = trim((string)$d['fatherQualification']);
            if (array_key_exists('motherName',  $d)) $updateData['student_mother_name']          = trim((string)$d['motherName']);
            if (array_key_exists('motherOccupation',$d)) $updateData['mother_occupation']        = trim((string)$d['motherOccupation']);
            if (array_key_exists('motherQualification',$d)) $updateData['mother_qualification']  = trim((string)$d['motherQualification']);
            if (array_key_exists('cAddressLine1',$d)) $updateData['student_c_address_line_1']    = trim((string)$d['cAddressLine1']);
            if (array_key_exists('cAddressLine2',$d)) $updateData['student_c_address_line_2']    = trim((string)$d['cAddressLine2']);
            if (array_key_exists('cAddressCity', $d)) $updateData['student_c_address_city']      = trim((string)$d['cAddressCity']);
            if (array_key_exists('cAddressState',$d)) $updateData['student_c_address_state']     = trim((string)$d['cAddressState']);
            if (array_key_exists('cAddressZipCode',$d)) $updateData['student_c_address_zip']     = trim((string)$d['cAddressZipCode']);
            if (array_key_exists('pAddressLine1',$d)) $updateData['student_p_address_line_1']    = trim((string)$d['pAddressLine1']);
            if (array_key_exists('pAddressLine2',$d)) $updateData['student_p_address_line_2']    = trim((string)$d['pAddressLine2']);
            if (array_key_exists('pAddressCity', $d)) $updateData['student_p_address_city']      = trim((string)$d['pAddressCity']);
            if (array_key_exists('pAddressState',$d)) $updateData['student_p_address_state']     = trim((string)$d['pAddressState']);
            if (array_key_exists('pAddressZipCode',$d)) $updateData['student_p_address_zip']     = trim((string)$d['pAddressZipCode']);

            if (empty($updateData)) {
                return $this->response
                    ->withType('application/json')
                    ->withStringBody(json_encode(['status' => false, 'message' => 'No valid fields to update']));
            }

            Log::error("[updateStudent] updateData=" . json_encode($updateData));

            // Use raw SQL to bypass ORM date/validation issues entirely
            try {
                $db = ConnectionManager::get('default');
                $setClauses = [];
                $params     = [];
                foreach ($updateData as $col => $val) {
                    $setClauses[] = "{$col} = ?";
                    $params[]     = $val;
                }
                $params[] = $id;
                $params[] = $ssmsClientCode;
                $sql = "UPDATE ssms_student_registration SET "
                     . implode(', ', $setClauses)
                     . " WHERE registration_id = ? AND ssms_client_code = ?";

                $db->execute($sql, $params);
                Log::error("[updateStudent] raw SQL SUCCESS for {$id}");

                return $this->response
                    ->withType('application/json')
                    ->withStringBody(json_encode(['status' => true, 'message' => 'Student updated successfully']));

            } catch (\Exception $e) {
                Log::error("[updateStudent] raw SQL FAILED: " . $e->getMessage());
                return $this->response
                    ->withType('application/json')
                    ->withStringBody(json_encode(['status' => false, 'message' => 'Failed to update student: ' . $e->getMessage()]));
            }
        }
    
    public function enrollStudent($registration_id = null)
    {

        $ssmsUserName = $this->request->getHeaderLine('ssmsUserName');
		$ssmsUserRole = $this->request->getHeaderLine('ssmsUserRole');
		$ssmsClientCode = $this->request->getHeaderLine('ssmsClientCode');	
        Log::write('error', 'ssmsUserName is :'. $ssmsUserName);
        if($ssmsUserRole == 'admin' || $ssmsUserRole == 'owner')
		{
        $ssmsStudentRegistration = $this->fetchTable('SsmsStudentRegistration');         
        $detailsFromRegistation = $ssmsStudentRegistration->get($registration_id);
		$data = $this->request->getData();
		$enrollmentNum = $this->getEnrollmentNumber($registration_id, $ssmsClientCode);
        $ssmsStudentEnrollment = $this->fetchTable('SsmsStudentEnrollment');         

        $ssmsStudentEnrollment = $ssmsStudentEnrollment->newEntity([]);
		
        if ($this->request->is('post'))
         
         {
            $data = $this->request->getData();
			$data['registration_id'] = $registration_id;
            $data['enrollment_id'] = $enrollmentNum;
			$courseMedium = $this->request->getData('course_medium');
			$sessionId = $this->request->getData('session_id');
			$classId = $this->request->getData('class_id'); 
			$sectionId = $this->request->getData('section_id');
			$branchId = $this->request->getData('branch_id'); 
	
			//if($this->checkFeeDefinedForClassAndSession($sessionId, $classId, $branchId, $ssmsClientCode))
			//{
              // Log::write('error', 'checkFeeDefinedForClassAndSession returned TRUE');

                if($enrollmentNum == null)
				 {
					 $enrollmentNum = $this->generateEnrollmentNumber($ssmsClientCode);
				 }
				$nextRollNum = $this->getNextRollNumber($classId, $sectionId, $sessionId, $branchId, $ssmsClientCode);
                $data['roll_number'] = $nextRollNum;
				if(!$this->enrollmentExistForASession($registration_id, $classId, $sectionId, $sessionId, $branchId, $ssmsClientCode))
				{
					//if enrollment is not done for this session/class/section
					if($this->getClassHeadCount($classId, $sectionId, $sessionId, $branchId, $ssmsClientCode) < $this->getSectionStudentLimit($sectionId, $ssmsClientCode))
					{ //if there is vacant seat with limit on a session/class
					  // $enrollmentNum = $this->generateEnrollmentNumber(); 
						// dump($enrollmentNum);
                   

					$connection = ConnectionManager::get('default');

					$insertIntoEnrollmentQuery = "INSERT INTO  ssms_student_enrollment (enrollment_id, roll_number, course_medium, ssms_client_code, session_id, class_id, section_id, registration_id, branch_id, status) VALUES('". $enrollmentNum. "', '" .$nextRollNum . "', '". $courseMedium ."', '" . $ssmsClientCode."', ".$sessionId. ", ". $classId. ", ". $sectionId. ", '".$registration_id."',". $branchId. ", 'active')";	
					
                  // $ssmsStudentEnrollment = $this->SsmsStudentEnrollment->patchEntity($ssmsStudentEnrollment, $this->request->getData());
                   
           			// debug($ssmsStudentEnrollment);
                  // if ($this->SsmsStudentEnrollment->save($ssmsStudentEnrollment)) 
				try {
					 $connection->execute($insertIntoEnrollmentQuery);
					//$this->insertAllFees($sessionId, $classId,$enrollmentNum, $registration_id ,$branchId, 'Academic', $ssmsClientCode, $ssmsUserName);
					
					 $studentFiles = $connection->execute("Update ssms_student_registration SET enroll_status = 'enrolled'  WHERE ssms_client_code = '" . $ssmsClientCode."' AND registration_id = '".$registration_id."'");
					   $response = [
                                'status' => true,
                                'message' => 'Student is enrolled successfully',
                                 "enrollmentId"=>$enrollmentNum
                                ];   
					   }
				catch(Exception $e){
					//Log::write('error',$e->getMessage());
					$response = [
                                'status' => false,
                                'message' => $e->getMessage()
                                ]; 
                    }
                   
                    
               }
                else
                {
                    $response = [
                                'status' => false,
                                'message' => 'No seat available in this section. Please enroll in another section of this class.'
                                ]; 
	 
                }
            }
             else
             {
                  $response = [
                                'status' => false,
                                'message' => 'This student is already enrolled.'
                                ]; 
             }
			//}
			//else
			//{
   //             $response = [
   //                             'status' => false,
   //                             'message' => 'No fees defined for this class/session. Please setup the fee structure first'
   //                             ]; 
			//}

        }
		}
		else
		{
            $response = [
                                'status' => false,
                                'message' => 'You are not authorised to enroll the student.'
                                ]; 
			
            
		}
    
       Log::write('error', 'response: '.  $this->response
                ->withType('application/json')
                ->withStringBody(json_encode($response)));

        return $this->response
                ->withType('application/json')
                ->withStringBody(json_encode($response));
        
}
    function getEnrollmentNumber($regId,$ssmsClientCode)
        {
		
        $session = $this->request->getSession();
        $ssmsStudentEnrollment = $this->fetchTable('SsmsStudentEnrollment');         

        $enrollment = $ssmsStudentEnrollment->find()
            ->select(['enrollment_id'])
            ->where(['ssms_client_code' => $ssmsClientCode, 'registration_id' => $regId])
            ->orderByDesc('enrollment_id');
          $enrollmentCount = $enrollment->count();
		  if($enrollmentCount>0) 
		  {
			  foreach ($enrollment as $row)
				  return $row->enrollment_id;
		  }
			else 
			  return null;
      
    }
     function enrollmentExistForASession($regId, $classID, $sectionId, $sessionid, $branchId, $ssmsClientCode)
        {
         $current_enroll_number="";
        $SsmsEnrollTable = $this->fetchTable('SsmsStudentEnrollment');         

        $classHead = $SsmsEnrollTable->find()
            ->select(['registration_id'])
            ->where(['ssms_client_code' => $ssmsClientCode, 'class_id' => $classID,
                     'section_id' => $sectionId, 'session_id' => $sessionid,
                     'registration_id' => $regId, 'branch_id' => $branchId])
            ->orderByDesc('enrollment_id');
          $classHeadCount = $classHead->count();
          //dump($classHead);
      if($classHeadCount>0) 
          return true;
        else 
          return false;
      
    }
    	
	function checkFeeDefinedForClassAndSession($session_id, $class_id,$branchId,$ssmsClientCode)
	{
       // Log::write('error', 'Inside checkFeeDefinedForClassAndSession function. Value for $session_id: '. $session_id. "classId:". $class_id. "branchId:".$branchId);

		$session = $this->request->getSession();
        //$SsmsFeeStructure = $this->loadModel('SsmsFeeStructure');
        $SsmsFeeStructure = $this->fetchTable('SsmsFeeStructure');         

        $feeItems = $SsmsFeeStructure->find()
            ->where(['ssms_client_code' => $ssmsClientCode, 'class_id' => $class_id,
                     'session_id' => $session_id, 'branch_id' => $branchId]);
              //  Log::write('error', 'fee count'. $feeItems->count());

        if($feeItems->count()> 0 )
			return true;
		else
		{
			return false;
		}
	}
    public function generateEnrollmentNumber($ssmsClientCode)
        {
            $prefix = "E" . $ssmsClientCode;
            $year = date("Y");

            $SsmsEnrollTable = $this->fetchTable('SsmsStudentEnrollment');

            $lastEnrollment = $SsmsEnrollTable->find()
                ->select(['enrollment_id'])
                ->where(['ssms_client_code' => $ssmsClientCode])
                ->orderBy(['enrollment_id' => 'DESC'])
                ->first();

            // Default first enrollment number
            if (empty($lastEnrollment) || empty($lastEnrollment->enrollment_id)) {
                return $prefix . "-" . $year . "-0001";
            }

            $currentEnrollNumber = trim((string)$lastEnrollment->enrollment_id);

            $pieces = explode("-", $currentEnrollNumber);

            // If existing enrollment number format is invalid
            if (count($pieces) < 3) {
                return $prefix . "-" . $year . "-0001";
            }

            $lastYear = (string)$pieces[1];
            $lastSequence = (int)$pieces[2];

            if ($year === $lastYear) {
                $nextSequence = str_pad((string)($lastSequence + 1), 4, '0', STR_PAD_LEFT);
            } else {
                $nextSequence = '0001';
            }

            return $prefix . "-" . $year . "-" . $nextSequence;
        }
    function getNextRollNumber($classID, $sectionId, $sessionid, $branchId,$ssmsClientCode)
        {
        $current_enroll_number=null;
        $SsmsEnrollTable = $this->fetchTable('SsmsStudentEnrollment');         

        $lastRollNumber = $SsmsEnrollTable->find()
            ->select(['roll_number'])
            ->where(['ssms_client_code' => $ssmsClientCode, 'class_id' => $classID,
                     'section_id' => $sectionId, 'session_id' => $sessionid,
                     'status' => 'active', 'branch_id' => $branchId])
            ->orderByDesc('enrollment_id')
            ->limit(1);
          foreach($lastRollNumber as $row)
           {
            $current_enroll_number = $row->roll_number;
          }

         if($current_enroll_number != null || !empty($current_enroll_number))
         { 
             $nextRollNum = str_pad((string)((int)$current_enroll_number + 1), 3, '0', STR_PAD_LEFT);
             return $nextRollNum;
             }
            else {
                return "001";
            }
    
    }
    
    function getClassHeadCount($classID, $sectionId, $sessionid, $branchId, $ssmsClientCode)
        {
        $SsmsEnrollTable = $this->fetchTable('SsmsStudentEnrollment');                 
         $current_enroll_number="";
        $classHeadCount = $SsmsEnrollTable->find()
            ->where(['ssms_client_code' => $ssmsClientCode, 'class_id' => $classID,
                     'section_id' => $sectionId, 'session_id' => $sessionid,
                     'branch_id' => $branchId])
            ->count();
		 return $classHeadCount;
      
    }
    function getSectionStudentLimit($sectionId, $ssmsClientCode)
	{
		$connection = ConnectionManager::get('default');
		$getCapacityCommand = "Select capacity from ssms_sections where ssms_client_code = '". $ssmsClientCode."' AND section_id = ". $sectionId;
		$capacity = $connection->execute($getCapacityCommand);
		
		foreach ($capacity as $row)
				  return $row['capacity'];
		
	}
    
    function insertAllFees11($session_id, $class_id,$enrollmentNum, $regId,$branchId, $category, $ssmsClientCode,$ssmsUserName ) 
    {
		$connection = ConnectionManager::get('default');
        $feeItemQuery= "select * from ssms_fee_items fi, ssms_fee_structure fs where fi.fee_item_id = fs.fee_item_id  AND fi.category  = '".$category."' AND class_id =". $class_id. " AND session_id =". $session_id . " AND fi.ssms_client_code = '".$ssmsClientCode."' AND fs.branch_id = ". $branchId;
		$feeItems = $connection->execute($feeItemQuery);
        $feeItemsCount = $feeItems->count();
       // dump($feeItemsCount);
       $ssmsFeeTable = $this->fetchTable('SsmsFeePaidDetails');                 

      //  dump($feeItems);
          foreach($feeItems as $row)
           {
              // Build fee entity data without deprecated request->data[]
              $feeData = [
                  'fee_id'           => $row['fee_id'],
                  'session_id'       => $session_id,
                  'class_id'         => $class_id,
                  'ssms_client_code' => $ssmsClientCode,
                  'registration_id'  => $regId,
                  'branch_id'        => $branchId,
                  'enrollment_id'    => $enrollmentNum,
                  'fee_item_id'      => $row['fee_item_id'],
                  'fee_amount'       => $row['fee_amount'],
                  'balance_amount'   => $row['fee_amount'],
                  'receipt_number'   => 0,
                  'late_fee'         => 0,
                  'enrolled'         => 'Yes',
                  'ssms_user_name'   => $ssmsUserName,
                  'payment_date'     => null,
                  'paid_amount'      => 0,
              ];
              $ssmsFeeTable = $this->SsmsFeePaidDetails->newEntity($feeData);

			  $insertQuery = "INSERT INTO ssms_fee_paid_details (receipt_number, fee_amount, late_fee, balance_amount, ssms_client_code, session_id, class_id, branch_id, enrollment_id, registration_id, fee_item_id, enrolled, ssms_user_name, fee_id) VALUES ( 0, ".$row['fee_amount']. ", 0," . $row['fee_amount']. ", '".$ssmsClientCode. "', ". $session_id. ", ". $class_id. ", ".$branchId. ", '". $enrollmentNum. "', '" .$regId. "', ". $row['fee_item_id']. ", 'Yes', '". $ssmsUserName. "', ". $row['fee_id'].")";
			 // dump($insertQuery);
              if ($connection->execute($insertQuery)) {
               // $this->Flash->success(__('The ssms fee paid detail has been saved.'));

               // return $this->redirect(['action' => 'index']);
            }
              else 
            $this->Flash->error(__('The ssms fee detail could not be inserted. Please, try again.'));
          }

        
    }
    public function insertAllFees($session_id, $class_id, $enrollmentNum, $regId,$branchId, $category,$ssmsClientCode, $ssmsUserName)
    {
            $connection = ConnectionManager::get('default');
            $feeItemQuery = "SELECT 
                    fs.fee_id,
                    fs.fee_item_id,
                    fs.fee_amount
                FROM ssms_fee_items fi
                INNER JOIN ssms_fee_structure fs 
                    ON fi.fee_item_id = fs.fee_item_id
                WHERE fi.category = :category
                  AND fs.class_id = :class_id
                  AND fs.session_id = :session_id
                  AND fi.ssms_client_code = :ssms_client_code
                  AND fs.branch_id = :branch_id
                  AND fi.status != 'Inactive'
            ";

            $feeItems = $connection
                ->execute($feeItemQuery, [
                    'category' => $category,
                    'class_id' => $class_id,
                    'session_id' => $session_id,
                    'ssms_client_code' => $ssmsClientCode,
                    'branch_id' => $branchId,
                ])
                ->fetchAll('assoc');

            if (empty($feeItems)) {
                Log::error('No fee items found for insertAllFees');
                return false;
            }

            $FeePaidDetailsTable = $this->fetchTable('SsmsFeePaidDetails');

            try {
                foreach ($feeItems as $row) {
                   Log::error('Adding fee for : ' .  $row['fee_item_id']);

                    // Check if already inserted
                    $existing = $FeePaidDetailsTable->find()
                        ->where([
                            'session_id' => $session_id,
                            'class_id' => $class_id,
                            'branch_id' => $branchId,
                            'enrollment_id' => $enrollmentNum,
                            'registration_id' => $regId,
                            'fee_item_id' => $row['fee_item_id'],
                            'fee_id' => $row['fee_id'],
                            'ssms_client_code' => $ssmsClientCode,
                        ])
                        ->first();

                    if ($existing) {
                        // Update existing fee amount if structure changed
                        $existing = $FeePaidDetailsTable->patchEntity($existing, [
                            'fee_amount' => $row['fee_amount'],
                            'balance_amount' => $row['fee_amount'],
                            'late_fee' => 0,
                            'receipt_number' => 0,
                            'enrolled' => 'Yes',
                            'ssms_user_name' => $ssmsUserName,
                        ]);

                        $FeePaidDetailsTable->saveOrFail($existing);
                    } else {
                        // Insert new fee record
                        $entity = $FeePaidDetailsTable->newEntity([
                            'receipt_number' => 0,
                            'fee_amount' => $row['fee_amount'],
                            'late_fee' => 0,
                            'balance_amount' => $row['fee_amount'],
                            'ssms_client_code' => $ssmsClientCode,
                            'session_id' => $session_id,
                            'class_id' => $class_id,
                            'branch_id' => $branchId,
                            'enrollment_id' => $enrollmentNum,
                            'registration_id' => $regId,
                            'fee_item_id' => $row['fee_item_id'],
                            'ssms_user_name' => $ssmsUserName,
                            'fee_paid_date' => null,
                            'fee_id' => $row['fee_id'],
                        ]);

                        $FeePaidDetailsTable->saveOrFail($entity);
                    }
                }

                return true;
            } catch (\Throwable $e) {
                Log::error('insertAllFees failed: ' . $e->getMessage());
                return false;
            }
        }
    
     public function getStudentsAttendance()
    {
        $class     = $this->request->getQuery('class');
        $section   = $this->request->getQuery('section');
        $date      = $this->request->getQuery('date');
        $branchId  = $this->request->getQuery('branchId');
        $sessionId = $this->request->getQuery('sessionId');

        $clientCode = $this->request->getAttribute('jwt_client_code')
                   ?? $this->request->getHeaderLine('ssmsClientCode');

        $Students   = $this->fetchTable('SsmsStudentEnrollment');
        $Attendance = $this->fetchTable('StudentAttendance');

        $whereClause = [
            'SsmsStudentEnrollment.class_id'         => $class,
            'SsmsStudentEnrollment.section_id'        => $section,
            'SsmsStudentEnrollment.ssms_client_code'  => $clientCode,
            'SsmsStudentEnrollment.status'            => 'active',
        ];
        if (!empty($branchId))  $whereClause['SsmsStudentEnrollment.branch_id']  = $branchId;
        if (!empty($sessionId)) $whereClause['SsmsStudentEnrollment.session_id'] = $sessionId;

        $baseSelect = [
            'enrollment_id'      => 'SsmsStudentEnrollment.enrollment_id',
            'student_first_name' => 'SsmsStudentRegistration.student_first_name',
            'student_last_name'  => 'SsmsStudentRegistration.student_last_name',
            'class_id'           => 'SsmsStudentEnrollment.class_id',
            'roll_number'        => 'SsmsStudentEnrollment.roll_number',
            'parent_phone'       => 'SsmsStudentRegistration.mobile_number',
        ];
        $hasMedium = false;
        try {
            $students = $Students->find()
                ->select(array_merge($baseSelect, ['course_medium' => 'SsmsStudentEnrollment.course_medium']))
                ->leftJoin(
                    ['SsmsStudentRegistration' => 'ssms_student_registration'],
                    ['SsmsStudentRegistration.registration_id = SsmsStudentEnrollment.registration_id']
                )
                ->where($whereClause)
                ->orderAsc('SsmsStudentEnrollment.roll_number')
                ->toArray();
            $hasMedium = true;
        } catch (\Exception $e) {
            // course_medium column may not exist on this install — retry without it
            $students = $Students->find()
                ->select($baseSelect)
                ->leftJoin(
                    ['SsmsStudentRegistration' => 'ssms_student_registration'],
                    ['SsmsStudentRegistration.registration_id = SsmsStudentEnrollment.registration_id']
                )
                ->where($whereClause)
                ->orderAsc('SsmsStudentEnrollment.roll_number')
                ->toArray();
        }

        $attWhere = [
            'class_id'         => $class,
            'section_id'       => $section,
            'attendance_date'  => $date,
            'ssms_client_code' => $clientCode,
        ];
        if (!empty($branchId))  $attWhere['branch_id']  = $branchId;
        if (!empty($sessionId)) $attWhere['session_id'] = $sessionId;

        $attendanceData = $Attendance->find()
            ->where($attWhere)
            ->all()
            ->indexBy('enrollment_id')
            ->toArray();

        $result = [];
        foreach ($students as $student) {
            $status = 'P';
            if (isset($attendanceData[$student->enrollment_id])) {
                $status = $attendanceData[$student->enrollment_id]->attendance;
            }
            $result[] = [
                'id'           => $student->enrollment_id,
                'rollNumber'   => $student->roll_number,
                'classId'      => $student->class_id,
                'status'       => $status,
                'firstName'    => $student->student_first_name,
                'lastName'     => $student->student_last_name ?? '',
                'parent_phone' => trim((string)($student->parent_phone  ?? '')),
                'medium'       => $hasMedium ? trim((string)($student->course_medium ?? '')) : '',
            ];
        }

        // School name + phone — used in WhatsApp absence messages
        $schoolName  = '';
        $schoolPhone = '';
        try {
            $db  = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();
            $row = $db->execute(
                "SELECT ssms_client_header_text, ssms_client_name FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
                [$clientCode]
            )->fetch('assoc');
            if (is_array($row)) {
                $schoolName = trim((string)($row['ssms_client_header_text'] ?? $row['ssms_client_name'] ?? ''));
            }
        } catch (\Throwable $e) {
            // Non-critical
        }
        // Fetch phone separately so an unknown-column error never breaks the main response
        try {
            $db  = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();
            $row = $db->execute(
                "SELECT ssms_client_phone FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
                [$clientCode]
            )->fetch('assoc');
            if (is_array($row)) {
                $schoolPhone = trim((string)($row['ssms_client_phone'] ?? ''));
            }
        } catch (\Throwable $e) {
            // Column may not exist or may be a non-string type — safe to ignore
        }

        return $this->response
            ->withType('application/json')
            ->withStatus(200)
            ->withStringBody(json_encode([
                'success'     => true,
                'data'        => $result,
                'schoolName'  => $schoolName,
                'schoolPhone' => $schoolPhone,
            ]));
    }
    
    public function saveAttendance()
    {
        $data       = $this->request->getData();
        $Attendance = $this->fetchTable('StudentAttendance');
        $clientCode = $this->request->getAttribute('jwt_client_code')
                   ?? $this->request->getHeaderLine('ssmsClientCode');
        $userRole   = strtolower(trim($this->request->getHeaderLine('ssmsUserRole') ?? ''));

        // branchId comes from the request body (sent by the app)
        $branchId  = $data['branch_id']  ?? $this->request->getHeaderLine('branchId') ?? '';
        $sessionId = $data['session_id'] ?? $this->getACurrentSession($clientCode);
        $now       = date('Y-m-d H:i:s');

        $attendanceDate = $data['date'] ?? date('Y-m-d');
        $today          = date('Y-m-d');

        // Past-date guard — only admins / owners can edit past attendance
        if ($attendanceDate < $today && !in_array($userRole, ['admin', 'owner'])) {
            return $this->response
                ->withType('application/json')
                ->withStatus(403)
                ->withStringBody(json_encode([
                    'success' => false,
                    'message' => 'You are not allowed to update past attendance.',
                ]));
        }

        if (empty($data['attendance']) || !is_array($data['attendance'])) {
            return $this->response
                ->withType('application/json')
                ->withStatus(422)
                ->withStringBody(json_encode([
                    'success' => false,
                    'message' => 'No attendance records provided.',
                ]));
        }

        $saved  = 0;
        $errors = 0;
        foreach ($data['attendance'] as $record) {
            $enrollmentId = $record['id'] ?? null;
            if (!$enrollmentId) continue;

            $existing = $Attendance->find()
                ->where([
                    'enrollment_id'   => $enrollmentId,
                    'attendance_date' => $attendanceDate,
                    'ssms_client_code' => $clientCode,
                ])
                ->first();

            if ($existing) {
                $existing->attendance = $record['status'] ?? 'P';
                $existing->modified   = $now;
                $Attendance->save($existing) ? $saved++ : $errors++;
            } else {
                $entity = $Attendance->newEntity([
                    'enrollment_id'    => $enrollmentId,
                    'class_id'         => $data['class_id']   ?? null,
                    'section_id'       => $data['section_id'] ?? null,
                    'attendance_date'  => $attendanceDate,
                    'attendance'       => $record['status']   ?? 'P',
                    'ssms_client_code' => $clientCode,
                    'branch_id'        => $branchId,
                    'session_id'       => $sessionId,
                    'roll_number'      => $record['rollNumber'] ?? null,
                    'created'          => $now,
                    'modified'         => $now,
                ]);
                $Attendance->save($entity) ? $saved++ : $errors++;
            }
        }

        return $this->response
            ->withType('application/json')
            ->withStatus(200)
            ->withStringBody(json_encode([
                'success' => true,
                'message' => "Attendance saved. {$saved} record(s) updated.",
                'saved'   => $saved,
                'errors'  => $errors,
            ]));
    }
    
    /**
     * getRecentAttendance — last N days attendance matrix for a class/section.
     * Uses the same student query as getStudentsAttendance.
     *
     * GET /StudentApi/getRecentAttendance?classId=3&sectionId=2&branchId=1&days=10
     */
    public function getRecentAttendance(): void
    {
        $this->request->allowMethod(['get']);

        $clientCode = $this->request->getAttribute('jwt_client_code')
                   ?? $this->request->getHeaderLine('ssmsClientCode');
        $classId    = $this->request->getQuery('classId');
        $sectionId  = $this->request->getQuery('sectionId');
        $branchId   = $this->request->getQuery('branchId');
        $sessionId  = $this->request->getQuery('sessionId');
        $numDays    = min(30, max(1, (int)($this->request->getQuery('days') ?? 10)));

        Log::error("[getRecentAttendance] clientCode={$clientCode} classId={$classId} sectionId={$sectionId} branchId=" . var_export($branchId, true) . " sessionId={$sessionId} days={$numDays}");

        if (!$classId || !$sectionId) {
            $this->response = $this->response->withStatus(422);
            $this->set(['status' => false, 'message' => 'classId and sectionId are required.']);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
            return;
        }

        // ── Build date range ─────────────────────────────────────────────────
        $today = date('Y-m-d');
        $dates = [];
        for ($i = $numDays - 1; $i >= 0; $i--) {
            $dates[] = date('Y-m-d', strtotime("-{$i} days"));
        }
        $startDate = $dates[0];
        $endDate   = $dates[$numDays - 1];
        $columns   = array_map(fn($d) => date('d M', strtotime($d)), $dates);
        $dayNames  = array_map(fn($d) => date('D', strtotime($d)),   $dates);

        // ── Same student query as getStudentsAttendance ──────────────────────
        $Students    = $this->fetchTable('SsmsStudentEnrollment');
        $whereClause = [
            'SsmsStudentEnrollment.class_id'         => $classId,
            'SsmsStudentEnrollment.section_id'       => $sectionId,
            'SsmsStudentEnrollment.ssms_client_code' => $clientCode,
            'SsmsStudentEnrollment.status'           => 'active',
        ];
        // Add branchId to student filter when a real value is provided
        if (!empty($branchId)) {
            $whereClause['SsmsStudentEnrollment.branch_id'] = $branchId;
        }
        if (!empty($sessionId)) {
            $whereClause['SsmsStudentEnrollment.session_id'] = $sessionId;
        }

        $students = $Students->find()
            ->select([
                'enrollment_id'      => 'SsmsStudentEnrollment.enrollment_id',
                'student_first_name' => 'SsmsStudentRegistration.student_first_name',
                'student_last_name'  => 'SsmsStudentRegistration.student_last_name',
                'roll_number'        => 'SsmsStudentEnrollment.roll_number',
            ])
            ->leftJoin(
                ['SsmsStudentRegistration' => 'ssms_student_registration'],
                ['SsmsStudentRegistration.registration_id = SsmsStudentEnrollment.registration_id']
            )
            ->where($whereClause)
            ->orderAsc('SsmsStudentEnrollment.roll_number')
            ->toArray();

        Log::error("[getRecentAttendance] where=" . json_encode($whereClause) . " students_found=" . count($students));
        if (empty($students)) {
            $this->set(['status' => true, 'columns' => $columns, 'dayNames' => $dayNames, 'students' => []]);
            $this->viewBuilder()->setOption('serialize', ['status', 'columns', 'dayNames', 'students']);
            return;
        }

        // ── Fetch attendance for this period ─────────────────────────────────
        $Attendance = $this->fetchTable('StudentAttendance');
        $attWhere   = [
            'class_id'           => $classId,
            'section_id'         => $sectionId,
            'ssms_client_code'   => $clientCode,
            'attendance_date >=' => $startDate,
            'attendance_date <=' => $endDate,
        ];
        // Include branchId filter only when a real branch is provided
        if (!empty($branchId) && $branchId !== '0') {
            $attWhere['branch_id'] = $branchId;
        }
        if (!empty($sessionId)) {
            $attWhere['session_id'] = $sessionId;
        }

        $attRows = $Attendance->find()->where($attWhere)->all()->toArray();

        // Index: enrollment_id → col_label → status
        $attIndex    = [];
        $holidayCols = [];
        foreach ($attRows as $row) {
            $col = date('d M', strtotime((string)$row->attendance_date));
            $attIndex[$row->enrollment_id][$col] = $row->attendance;
            if ($row->attendance === 'H') $holidayCols[$col] = true;
        }

        // ── Build per-student result ─────────────────────────────────────────
        $result = [];
        foreach ($students as $stu) {
            $eid     = $stu->enrollment_id;
            $days    = [];
            $present = 0; $total = 0;

            foreach ($dates as $i => $dateStr) {
                $col      = $columns[$i];
                $isSun    = (date('D', strtotime($dateStr)) === 'Sun');
                $isFuture = ($dateStr > $today);
                $val      = $attIndex[$eid][$col] ?? null;

                if ($isFuture) {
                    $days[$col] = '-';
                } elseif ($val === 'P' || $val === '1') {
                    $days[$col] = 'P'; $present++; $total++;
                } elseif ($val === 'L') {
                    $days[$col] = 'L'; $total++;
                } elseif ($val === 'H' || isset($holidayCols[$col])) {
                    $days[$col] = 'H';
                } elseif ($isSun) {
                    $days[$col] = 'S';
                } else {
                    $days[$col] = '-'; // no record — show blank, not absent
                }
            }

            $percent  = $total > 0 ? round(($present / $total) * 100) : 0;
            $result[] = [
                'id'         => $eid,
                'firstName'  => trim(($stu->student_first_name ?? '') . ' ' . ($stu->student_last_name ?? '')),
                'rollNumber' => $stu->roll_number,
                'days'       => $days,
                'present'    => $present,
                'total'      => $total,
                'percent'    => $percent,
            ];
        }

        $this->set([
            'status'   => true,
            'columns'  => $columns,
            'dayNames' => $dayNames,
            'students' => $result,
        ]);
        $this->viewBuilder()->setOption('serialize', ['status', 'columns', 'dayNames', 'students']);
    }

    /**
     * getMonthlyAttendance — full month attendance matrix.
     * Used by AttendanceReportScreen.
     *
     * GET /StudentApi/getMonthlyAttendance?classId=3&sectionId=2&branchId=1&year=2025&month=6
     */
    public function getMonthlyAttendance(): void
    {
        $this->request->allowMethod(['get']);

        $clientCode = $this->request->getAttribute('jwt_client_code')
                   ?? $this->request->getHeaderLine('ssmsClientCode');
        $classId    = $this->request->getQuery('classId');
        $sectionId  = $this->request->getQuery('sectionId');
        $branchId   = $this->request->getQuery('branchId');
        $year       = (int)($this->request->getQuery('year')  ?? date('Y'));
        $month      = (int)($this->request->getQuery('month') ?? date('n'));

        if (!$classId || !$sectionId || !$year || !$month) {
            $this->response = $this->response->withStatus(422);
            $this->set(['status' => false, 'message' => 'classId, sectionId, year and month are required.']);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
            return;
        }

        $today       = date('Y-m-d');
        $daysInMonth = cal_days_in_month(CAL_GREGORIAN, $month, $year);
        $startDate   = sprintf('%04d-%02d-01', $year, $month);
        $endDate     = sprintf('%04d-%02d-%02d', $year, $month, $daysInMonth);

        // Columns (zero-padded day numbers) and day names
        $columns  = [];
        $dayNames = [];
        for ($d = 1; $d <= $daysInMonth; $d++) {
            $dateStr    = sprintf('%04d-%02d-%02d', $year, $month, $d);
            $columns[]  = str_pad((string)$d, 2, '0', STR_PAD_LEFT);
            $dayNames[] = date('l', strtotime($dateStr));
        }

        // Students — filtered by branch when provided
        $Students    = $this->fetchTable('SsmsStudentEnrollment');
        $whereClause = [
            'SsmsStudentEnrollment.class_id'         => $classId,
            'SsmsStudentEnrollment.section_id'       => $sectionId,
            'SsmsStudentEnrollment.ssms_client_code' => $clientCode,
            'SsmsStudentEnrollment.status'           => 'active',
        ];
        if (!empty($branchId) && $branchId !== '0') {
            $whereClause['SsmsStudentEnrollment.branch_id'] = $branchId;
        }

        $students = $Students->find()
            ->select([
                'enrollment_id'      => 'SsmsStudentEnrollment.enrollment_id',
                'student_first_name' => 'SsmsStudentRegistration.student_first_name',
                'student_last_name'  => 'SsmsStudentRegistration.student_last_name',
                'roll_number'        => 'SsmsStudentEnrollment.roll_number',
                'parent_phone'       => 'SsmsStudentRegistration.mobile_number',
                'course_medium'      => 'SsmsStudentEnrollment.course_medium',
            ])
            ->leftJoin(
                ['SsmsStudentRegistration' => 'ssms_student_registration'],
                ['SsmsStudentRegistration.registration_id = SsmsStudentEnrollment.registration_id']
            )
            ->where($whereClause)
            ->orderAsc('SsmsStudentEnrollment.roll_number')
            ->toArray();

        if (empty($students)) {
            $this->set(['status' => true, 'meta' => [], 'columns' => $columns, 'dayNames' => $dayNames, 'students' => []]);
            $this->viewBuilder()->setOption('serialize', ['status', 'meta', 'columns', 'dayNames', 'students']);
            return;
        }

        // Attendance rows for the month
        $Attendance = $this->fetchTable('StudentAttendance');
        $attWhere   = [
            'class_id'           => $classId,
            'section_id'         => $sectionId,
            'ssms_client_code'   => $clientCode,
            'attendance_date >=' => $startDate,
            'attendance_date <=' => $endDate,
        ];
        if (!empty($branchId) && $branchId !== '0') {
            $attWhere['branch_id'] = $branchId;
        }

        $attRows = $Attendance->find()->where($attWhere)->all()->toArray();

        // Index: enrollment_id → day_col → attendance
        $attIndex    = [];
        $holidayCols = [];
        foreach ($attRows as $row) {
            $col = str_pad((string)(int)date('d', strtotime((string)$row->attendance_date)), 2, '0', STR_PAD_LEFT);
            $attIndex[$row->enrollment_id][$col] = $row->attendance;
            if ($row->attendance === 'H') $holidayCols[$col] = true;
        }

        // Resolve names for meta
        $db = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();
        $classRow    = $db->execute("SELECT class_name FROM ssms_classes WHERE class_id = ? LIMIT 1",   [$classId])->fetch('assoc');
        $sectionRow  = $db->execute("SELECT section_name FROM ssms_sections WHERE section_id = ? LIMIT 1", [$sectionId])->fetch('assoc');
        $branchRow   = $db->execute("SELECT branch_name FROM ssms_branch WHERE branch_id = ? LIMIT 1",  [$branchId ?: 0])->fetch('assoc');
        $schoolRow   = $db->execute("SELECT ssms_client_name, ssms_client_header_text, ssms_client_address, ssms_client_city, ssms_client_state, ssms_client_zip, ssms_client_email FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1", [$clientCode])->fetch('assoc');
        // Fetch phone separately — column may not exist on all installs
        $schoolPhoneRow = null;
        try {
            $schoolPhoneRow = $db->execute(
                "SELECT ssms_client_phone FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
                [$clientCode]
            )->fetch('assoc');
        } catch (\Exception $e) { }

        $monthNames = [1=>'January',2=>'February',3=>'March',4=>'April',5=>'May',6=>'June',
                       7=>'July',8=>'August',9=>'September',10=>'October',11=>'November',12=>'December'];

        // Per-student result
        $result = [];
        foreach ($students as $stu) {
            $eid     = $stu->enrollment_id;
            $days    = [];
            $present = 0; $total = 0;

            for ($d = 1; $d <= $daysInMonth; $d++) {
                $col      = str_pad((string)$d, 2, '0', STR_PAD_LEFT);
                $dateStr  = sprintf('%04d-%02d-%02d', $year, $month, $d);
                $isSun    = (date('l', strtotime($dateStr)) === 'Sunday');
                $isFuture = ($dateStr > $today);
                $val      = $attIndex[$eid][$col] ?? null;

                if ($isFuture) {
                    $days[$col] = '-';
                } elseif ($val === 'P' || $val === '1') {
                    $days[$col] = 'P'; $present++; $total++;
                } elseif ($val === 'L') {
                    $days[$col] = 'L'; $total++;
                } elseif ($val === 'H' || isset($holidayCols[$col])) {
                    $days[$col] = 'H';
                } elseif ($isSun) {
                    $days[$col] = 'S';
                } else {
                    $days[$col] = 'A'; $total++;
                }
            }

            $percent  = $total > 0 ? round(($present / $total) * 100) : 0;
            $result[] = [
                'enrollment_id' => $eid,
                'student_name'  => trim(($stu->student_first_name ?? '') . ' ' . ($stu->student_last_name ?? '')),
                'roll_number'   => $stu->roll_number,
                'parent_phone'  => trim((string)($stu->parent_phone ?? '')),
                'medium'        => trim((string)($stu->course_medium ?? '')),
                'days'          => $days,
                'present'       => $present,
                'total'         => $total,
                'percent'       => $percent,
            ];
        }

        $this->set([
            'status'   => true,
            'meta'     => [
                'year'          => $year,
                'month'         => $month,
                'monthName'     => $monthNames[$month] ?? '',
                'days'          => $daysInMonth,
                'className'     => $classRow['class_name']    ?? '',
                'sectionName'   => $sectionRow['section_name'] ?? '',
                'branchName'    => $branchRow['branch_name']   ?? '',
                'schoolName'    => is_array($schoolRow) ? trim($schoolRow['ssms_client_header_text'] ?? $schoolRow['ssms_client_name'] ?? '') : '',
                'schoolAddress' => is_array($schoolRow) ? trim($schoolRow['ssms_client_address'] ?? '') : '',
                'schoolCity'    => is_array($schoolRow) ? trim($schoolRow['ssms_client_city']    ?? '') : '',
                'schoolState'   => is_array($schoolRow) ? trim($schoolRow['ssms_client_state']   ?? '') : '',
                'schoolZip'     => is_array($schoolRow) ? trim($schoolRow['ssms_client_zip']     ?? '') : '',
                'schoolEmail'   => is_array($schoolRow) ? trim($schoolRow['ssms_client_email']   ?? '') : '',
                'schoolPhone'   => (is_array($schoolPhoneRow) && isset($schoolPhoneRow['ssms_client_phone'])) ? trim((string)$schoolPhoneRow['ssms_client_phone']) : '',
                'studentCount'  => count($result),
            ],
            'columns'  => $columns,
            'dayNames' => $dayNames,
            'students' => $result,
        ]);
        $this->viewBuilder()->setOption('serialize', ['status', 'meta', 'columns', 'dayNames', 'students']);
    }

    public function getIdCardData(): void
    {
        $this->request->allowMethod(['get']);
 
        $classId   = $this->request->getQuery('classId');
        $sessionId = $this->request->getQuery('sessionId');
        $branchId  = $this->request->getQuery('branchId');
        $sectionId = $this->request->getQuery('sectionId');

        // Read verified JWT attributes (set by JwtAuthMiddleware)
        $clientCode = $this->request->getAttribute('jwt_client_code')
            ?? $this->request->getHeaderLine('ssmsClientCode');

        if (empty($classId) || empty($sessionId)) {
            $this->response = $this->response->withStatus(422);
            $this->set(['status' => false, 'message' => 'classId and sessionId are required.']);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
            return;
        }

        $db = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();

        // ── Fetch students ────────────────────────────────────────────────────
        $whereSql = "WHERE e.class_id = ? AND e.session_id = ? AND e.ssms_client_code = ? AND e.status = 'active'";
        $params   = [(int)$classId, (int)$sessionId, $clientCode];
        if (!empty($branchId))  { $whereSql .= " AND e.branch_id = ?";  $params[] = (int)$branchId;  }
        if (!empty($sectionId)) { $whereSql .= " AND e.section_id = ?"; $params[] = (int)$sectionId; }

        $students = $db->execute("
            SELECT
                e.enrollment_id                 AS enrollmentId,
                r.registration_id               AS registrationNo,
                r.admission_number              AS admissionNumber,
                r.student_first_name            AS firstName,
                r.student_last_name             AS lastName,
                r.student_dob                   AS dob,
                r.student_gender                AS gender,
                r.blood_group                   AS bloodGroup,
                r.student_father_name           AS fatherName,
                r.student_mother_name           AS motherName,
                r.mobile_number                 AS parentPhone,
                r.student_photo                 AS photo,
                r.ssms_client_code              AS ssmsClientCode,
                CONCAT_WS(', ',
                    NULLIF(TRIM(r.student_c_address_line_1), ''),
                    NULLIF(TRIM(r.student_c_address_line_2), ''),
                    NULLIF(TRIM(r.student_c_address_city),   ''),
                    NULLIF(TRIM(r.student_c_address_state),  ''),
                    NULLIF(TRIM(r.student_c_address_zip),    '')
                )                               AS address,
                c.class_name                    AS className,
                sec.section_name                AS section,
                s.session_name                  AS sessionName,
                s.session_id                    AS sessionId,
                c.class_id                      AS classId,
                tr.route_name                   AS busRoute
            FROM  ssms_student_enrollment e
            JOIN  ssms_student_registration r  ON r.registration_id = e.registration_id
            JOIN  ssms_classes              c  ON c.class_id        = e.class_id
            JOIN  ssms_sessions             s  ON s.session_id      = e.session_id
            JOIN  ssms_sections             sec ON sec.section_id   = e.section_id
            LEFT JOIN ssms_transport_enrollments te
                   ON CAST(te.enrollment_id AS CHAR) = CAST(e.enrollment_id AS CHAR)
                  AND te.ssms_client_code = e.ssms_client_code
                  AND te.status = 'active'
            LEFT JOIN ssms_transport_routes tr ON tr.route_id = te.route_id
            {$whereSql}
            ORDER BY r.student_first_name ASC, r.student_last_name ASC
        ", $params)->fetchAll('assoc');
 
        // ── Fetch school info + principal signature ───────────────────────────
        $school = $db->execute("
            SELECT
                c.ssms_client_header_text AS name,
                CONCAT_WS(', ',
                    NULLIF(c.ssms_client_address, ''),
                    NULLIF(c.ssms_client_city,    ''),
                    NULLIF(c.ssms_client_state,   '')
                )                         AS address,
                c.logo_name               AS logoName,
                c.ssms_client_phone       AS phone,
                COALESCE(ss.principal_signature, '') AS principalSignature
            FROM ssms_clients c
            LEFT JOIN ssms_school_settings ss ON ss.client_code = c.ssms_client_code
            WHERE c.ssms_client_code = ?
            LIMIT 1
        ", [$clientCode])->fetchAssoc();

        $baseUrl = rtrim(env('APP_URL', ''), '/');

        // Build logo URL if logo exists
        $logoUrl = null;
        if (!empty($school['logoName'])) {
            $logoUrl = $baseUrl . '/clients/' . $clientCode . '/' . $school['logoName'];
        }

        // Append file-mtime to signature filename so React Native busts its image cache
        // when a new signature is uploaded (same filename, different content).
        $sigFilename = $school['principalSignature'] ?? '';
        if (!empty($sigFilename)) {
            $sigPath  = dirname(WWW_ROOT) . DS . 'clients' . DS . $clientCode . DS . $sigFilename;
            $sigMtime = file_exists($sigPath) ? filemtime($sigPath) : 0;
            $sigFilename .= '?t=' . $sigMtime;
        }

        $this->set([
            'status'   => true,
            'school'   => [
                'name'               => $school['name']    ?? '',
                'address'            => $school['address'] ?? '',
                'logoUrl'            => $school['logoName'],
                'phone'              => $school['phone']   ?? '',
                'principalSignature' => $sigFilename,
                'ssmsClientCode'     => $clientCode,
            ],
            'students' => $students,
            'total'    => count($students),
        ]);
        $this->viewBuilder()->setOption('serialize', ['status', 'school', 'students', 'total']);
    }
    
     public function uploadStudentPhoto(): void
    {
        $this->request->allowMethod(['post']);
 
        // ── Read identity from JWT middleware ─────────────────────────────────
        $clientCode = $this->request->getAttribute('jwt_client_code')
                   ?? $this->request->getHeaderLine('ssmsClientCode')
                   ?? '';
 
        $registrationNo = trim((string)($this->request->getData('registrationNo') ?? ''));
 
        // ── Validate required fields ──────────────────────────────────────────
        if (empty($registrationNo)) {
            $this->_jsonError(422, 'registrationNo is required.');
            return;
        }
        if (empty($clientCode)) {
            $this->_jsonError(401, 'Client code missing. Please log in again.');
            return;
        }
 
        // ── Validate uploaded file ────────────────────────────────────────────
        $file = $this->request->getUploadedFile('student_photo');
 
        if (!$file || $file->getError() !== UPLOAD_ERR_OK) {
            $uploadErrors = [
                UPLOAD_ERR_INI_SIZE   => 'File exceeds server upload limit.',
                UPLOAD_ERR_FORM_SIZE  => 'File exceeds form upload limit.',
                UPLOAD_ERR_PARTIAL    => 'File was only partially uploaded.',
                UPLOAD_ERR_NO_FILE    => 'No file was uploaded.',
                UPLOAD_ERR_NO_TMP_DIR => 'Missing temp folder on server.',
                UPLOAD_ERR_CANT_WRITE => 'Failed to write file to disk.',
            ];
            $errMsg = $file
                ? ($uploadErrors[$file->getError()] ?? 'Unknown upload error.')
                : 'No file received.';
            $this->_jsonError(422, $errMsg);
            return;
        }
 
        // Allowed MIME types
        $allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        $clientMime   = $file->getClientMediaType();
        // Double-check using finfo (don't trust client-supplied MIME)
        $finfo        = new \finfo(FILEINFO_MIME_TYPE);
        $actualMime   = $finfo->file($file->getStream()->getMetadata('uri'));
 
        if (!in_array($actualMime, $allowedMimes, true)) {
            $this->_jsonError(415, "Unsupported file type: {$actualMime}. Allowed: JPEG, PNG, WEBP.");
            return;
        }
 
        // Max 5 MB
        $maxBytes = 5 * 1024 * 1024;
        if ($file->getSize() > $maxBytes) {
            $mb = round($file->getSize() / 1024 / 1024, 1);
            $this->_jsonError(413, "File too large ({$mb} MB). Maximum allowed is 5 MB.");
            return;
        }
        //// ── Ensure upload directory exists ────────────────────────────────────
       //// $uploadDir = WWW_ROOT . str_replace('/', DS, self::PHOTO_DIR);
        //$uploadDir = "../../clients/" .$ssmsClientCode. "/Students/" . $RegistrationNum ."/";
        //if (!is_dir($uploadDir)) {
        //    mkdir($uploadDir, 0755, true);
        //}
 //
        //// ── Move file to its permanent location ───────────────────────────────
        //$destination = $uploadDir . DS . $filename;
        // ── Build target directory ────────────────────────────────────────────
        $studentDir =  "../clients/" .$clientCode. "/Students/" . $registrationNo ."/";
        log::error(" the dir is : ". $studentDir);
        if (!is_dir($studentDir)) {
            if (!mkdir($studentDir, 0755, true)) {
                Log::error("uploadStudentPhoto: Could not create directory {$studentDir}");
                $this->_jsonError(500, 'Could not create student directory on server.');
                return;
            }
        }
 
        // ── Fetch existing photo from DB and delete physical file ─────────────
        try {
            $table = $this->getTableLocator()->get('SsmsStudentRegistration');
 
            $existing = $table->find()
                ->select(['student_photo'])
                ->where([
                    'registration_id'  => $registrationNo,
                    'ssms_client_code' => $clientCode,
                ])
                ->first();
 
            if ($existing && !empty($existing->student_photo)) {
                $oldFile = $studentDir . $existing->student_photo;
                if (is_file($oldFile)) {
                    if (!unlink($oldFile)) {
                        // Non-fatal — log but continue with upload
                        Log::warning("uploadStudentPhoto: Could not delete old file {$oldFile}");
                    }
                }
            }
        } catch (\Exception $e) {
            Log::error('uploadStudentPhoto: DB lookup failed — ' . $e->getMessage());
            // Non-fatal — continue with upload even if old file cleanup fails
        }
 
        // ── Build new filename ────────────────────────────────────────────────
        $extMap   = ['image/jpeg' => 'jpg', 'image/jpg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
        $ext      = $extMap[$actualMime] ?? 'jpg';
        $filename = 'photo_' . $registrationNo . '_' . time() . '.' . $ext;
        $destPath = $studentDir . $filename;
 
        // ── Move uploaded file to destination ─────────────────────────────────
        try {
            $file->moveTo($destPath);
        } catch (\Exception $e) {
            Log::error('uploadStudentPhoto: moveTo failed — ' . $e->getMessage());
            $this->_jsonError(500, 'Failed to save the uploaded file on the server.');
            return;
        }
 
        if (!is_file($destPath)) {
            $this->_jsonError(500, 'File was not saved correctly. Please try again.');
            return;
        }
 
        // ── Update DB ─────────────────────────────────────────────────────────
        try {
            $table = $this->getTableLocator()->get('SsmsStudentRegistration');
 
            $updated = $table->updateAll(
                ['student_photo' => $filename],
                [
                    'registration_id'  => $registrationNo,
                    'ssms_client_code' => $clientCode,
                ]
            );
 
            if ($updated === 0) {
                // File saved but no DB row matched — clean up and report
                @unlink($destPath);
                $this->_jsonError(404, "No student found with registration number: {$registrationNo}");
                return;
            }
        } catch (\Exception $e) {
            // DB update failed — clean up uploaded file
            @unlink($destPath);
            Log::error('uploadStudentPhoto: DB update failed — ' . $e->getMessage());
            $this->_jsonError(500, 'Photo saved but DB update failed: ' . $e->getMessage());
            return;
        }
 
        // ── Build public photo URL for immediate use in the app ───────────────
         ///$uploadDir = "../../clients/" .$ssmsClientCode. "/Students/" . $RegistrationNum ."/";
        //$appUrl   = rtrim((string)env('APP_URL', ''), '/');

        $appUrl   = rtrim((string)env('APP_URL', ''), '/');
        $photoUrl = "../.." . '/clients/' . $clientCode . '/Students/' . $registrationNo . '/';
        //if (!is_dir($photoUrl)) {
        //    mkdir($uploadDir, 0755, true);
        //}
 //
        //// ── Move file to its permanent location ───────────────────────────────
        //$destination = $photoUrl . DS . $filename;
 //
        //try {
        //    $file->moveTo($destination);
        //} catch (\Exception $e) {
        //    Log::error('StudentsController::saveStudentPhoto() moveTo failed: ' . $e->getMessage());
        //    return ['success' => false, 'filename' => null, 'message' => 'Could not save photo file: ' . $e->getMessage()];
        //}
        // ── Success ───────────────────────────────────────────────────────────
        Log::info("uploadStudentPhoto: Updated photo for {$registrationNo} → {$filename}");
 
        $this->set([
            'status'   => true,
            'message'  => 'Student photo updated successfully.',
            'filename' => $filename,
            'photoUrl' => $photoUrl,
        ]);
        $this->viewBuilder()->setOption('serialize', ['status', 'message', 'filename', 'photoUrl']);
    }
 
    /**
     * Helper — send a JSON error response without throwing an exception.
     * Add this private method to StudentApiController as well.
     */
    private function _jsonError(int $httpStatus, string $message): void
    {
        $this->response = $this->response->withStatus($httpStatus);
        $this->set(['status' => false, 'message' => $message]);
        $this->viewBuilder()->setOption('serialize', ['status', 'message']);
    }
    
    /**
 * updateEnrollment — add this action to StudentApiController
 * File: src/Controller/StudentApiController.php
 *
 * Route (add to config/routes.php):
 *   $builder->put('/studentApi/updateEnrollment',
 *       ['controller' => 'StudentApi', 'action' => 'updateEnrollment']);
 *
 * Accepts: PUT application/json
 *   {
 *     "enrollmentId": "ENR-001",
 *     "branchId":     2,
 *     "classId":      5,
 *     "sec tionId":    3
 *   }
 *
 * Access: admin and owner roles only — enforced in both JWT attributes
 *         and session role, whichever is available.
 */
 
    public function updateEnrollment(): void
    {
        $this->request->allowMethod(['put', 'post']);
 
        // ── Role check — admin / owner only ──────────────────────────────────
        $role = strtolower(trim((string)$this->request->getHeaderLine('ssmsUserRole')));

        if (!in_array($role, ['admin', 'owner'], true)) {
            $this->response = $this->response->withStatus(403);
            $this->set([
                'status'  => false,
                'message' => 'Access denied. Only admin or owner can update enrollment.',
            ]);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
            return;
        }
 
        // ── Read client code from JWT / header ────────────────────────────────
        $clientCode = $this->request->getAttribute('jwt_client_code')
                   ?? $this->request->getHeaderLine('ssmsClientCode')
                   ?? '';
 
        if (empty($clientCode)) {
            $this->response = $this->response->withStatus(401);
            $this->set(['status' => false, 'message' => 'Client code missing. Please log in again.']);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
            return;
        }
 
        // ── Parse request body ────────────────────────────────────────────────
        $body = $this->request->getData();
        log::error("data received from screen: ". json_encode($body));
        $enrollmentId  = trim((string)($body['enrollmentId'] ?? ''));
        $branchId      = isset($body['branchId'])  && $body['branchId']  !== '' ? (int)$body['branchId']  : null;
        $classId       = isset($body['classId'])   && $body['classId']   !== '' ? (int)$body['classId']   : null;
        $sectionId     = isset($body['sectionId']) && $body['sectionId'] !== '' ? (int)$body['sectionId'] : null;
        $statusAllowed = ['active', 'cancelled'];
        $newStatus     = isset($body['status']) && in_array(strtolower(trim((string)$body['status'])), $statusAllowed, true)
                         ? strtolower(trim((string)$body['status'])) : null;
         log::error("classId variable from screen: ". json_encode($classId));

        // ── Validation ────────────────────────────────────────────────────────
        $errors = [];
        if (empty($enrollmentId)) $errors[] = 'enrollmentId is required.';
        if (!$classId)            $errors[] = 'classId is required.';
        if (!$sectionId)          $errors[] = 'sectionId is required.';
 
        if (!empty($errors)) {
            $this->response = $this->response->withStatus(422);
            $this->set(['status' => false, 'message' => implode(' ', $errors)]);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
            return;
        }
 
        try {
            $table = $this->getTableLocator()->get('SsmsStudentEnrollment');
 
            // ── Verify the enrollment exists and belongs to this client ────────
            $enrollment = $table->find()
                ->select(['enrollment_id', 'class_id', 'section_id', 'branch_id'])
                ->where([
                    'enrollment_id'    => $enrollmentId,
                    'ssms_client_code' => $clientCode,
                ])
                ->first();
 
            if (!$enrollment) {
                $this->response = $this->response->withStatus(404);
                $this->set([
                    'status'  => false,
                    'message' => "Enrollment not found: {$enrollmentId}",
                ]);
                $this->viewBuilder()->setOption('serialize', ['status', 'message']);
                return;
            }
 
            // ── Build update fields ───────────────────────────────────────────
            $updateData = [
                'class_id'   => $classId,
                'section_id' => $sectionId,
            ];
            if ($branchId   !== null) $updateData['branch_id'] = $branchId;
            if ($newStatus  !== null) $updateData['status']    = $newStatus;
 
            // ── Save ──────────────────────────────────────────────────────────
            $entity  = $table->patchEntity($enrollment, $updateData);
            log::error("Update data: ". json_encode($updateData));
            log::error("entity data: ". json_encode($entity));

            $saved   = $table->save($entity);
 
            if (!$saved) {
                $this->response = $this->response->withStatus(500);
                $this->set([
                    'status'  => false,
                    'message' => 'Failed to save enrollment. Please try again.',
                    'errors'  => $entity->getErrors(),
                ]);
                $this->viewBuilder()->setOption('serialize', ['status', 'message', 'errors']);
                return;
            }
 
            // ── Success ───────────────────────────────────────────────────────
            \Cake\Log\Log::info(
                "updateEnrollment: [{$clientCode}] {$enrollmentId} → " .
                "class={$classId} section={$sectionId} branch={$branchId} by role={$role}"
            );
 
            $this->set([
                'status'       => true,
                'message'      => 'Enrollment updated successfully.',
                'enrollmentId' => $enrollmentId,
                'classId'      => $classId,
                'sectionId'    => $sectionId,
                'branchId'     => $branchId,
            ]);
            $this->viewBuilder()->setOption('serialize', [
                'status', 'message', 'enrollmentId', 'classId', 'sectionId', 'branchId',
            ]);
 
        } catch (\Exception $e) {
            \Cake\Log\Log::error('updateEnrollment exception: ' . $e->getMessage());
            $this->response = $this->response->withStatus(500);
            $this->set([
                'status'  => false,
                'message' => 'Server error: ' . $e->getMessage(),
            ]);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
        }
    }

    // =========================================================================
    // GET /StudentApi/getMyAttendance
    //
    // Returns the calling student's own attendance for the last 30 days.
    // The enrollment ID is taken from the JWT claim (jwt_user = ssms_user_name
    // which equals the enrollment ID for Student / Parent accounts).
    //
    // Response:
    //   { status, enrollmentId, summary: {present,absent,leave,holiday,total},
    //     days: [ { date, label, dayName, attendance }, … ] }
    // =========================================================================
    public function getMyAttendance()
    {
        $this->request->allowMethod(['get']);

        $clientCode = $this->request->getAttribute('jwt_client_code')
                   ?: $this->request->getHeaderLine('ssmsClientCode');

        $jwtEnrollId  = trim((string)($this->request->getAttribute('jwt_enrollment_id') ?? ''));
        $hdrEnrollId  = trim((string)($this->request->getHeaderLine('ssmsEnrollmentId') ?? ''));
        $hdrUserName  = trim((string)($this->request->getHeaderLine('ssmsUserName') ?? ''));
        $enrollmentId = $jwtEnrollId !== '' ? $jwtEnrollId
                      : ($hdrEnrollId !== '' ? $hdrEnrollId : $hdrUserName);

        if (!$enrollmentId) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode([
                    'status'  => false,
                    'message' => 'Enrollment ID not found in token.',
                ]));
        }

        $today     = new \DateTime('today');
        $startDate = (clone $today)->modify('-29 days'); // last 30 days inclusive
        $endDate   = $today;

        $db = $this->getTableLocator()->get('StudentAttendance')->getConnection();

        // ── Fetch raw attendance rows for this student ────────────────────────
        $rows = $db->execute(
            "SELECT attendance_date, attendance
             FROM   student_attendance
             WHERE  enrollment_id   = ?
               AND  ssms_client_code = ?
               AND  attendance_date >= ?
               AND  attendance_date <= ?
             ORDER  BY attendance_date ASC",
            [
                $enrollmentId,
                $clientCode,
                $startDate->format('Y-m-d'),
                $endDate->format('Y-m-d'),
            ]
        )->fetchAll('assoc');

        // Index by date string for quick lookup
        $attByDate = [];
        foreach ($rows as $row) {
            $attByDate[$row['attendance_date']] = $row['attendance'];
        }

        // ── Build a day-by-day array for the last 30 days ────────────────────
        $days    = [];
        $summary = ['present' => 0, 'absent' => 0, 'leave' => 0, 'holiday' => 0, 'total' => 0];

        $cursor = clone $startDate;
        while ($cursor <= $endDate) {
            $dateStr = $cursor->format('Y-m-d');
            $att     = $attByDate[$dateStr] ?? null; // null = no record

            // Count only days that have a record
            if ($att !== null) {
                $summary['total']++;
                if ($att === 'P') $summary['present']++;
                elseif ($att === 'A') $summary['absent']++;
                elseif ($att === 'L') $summary['leave']++;
                elseif ($att === 'H') $summary['holiday']++;
            }

            $days[] = [
                'date'       => $dateStr,
                'label'      => $cursor->format('d'),          // "01"–"31"
                'monthLabel' => $cursor->format('d M'),        // "01 Jan"
                'dayName'    => $cursor->format('D'),          // "Mon"
                'attendance' => $att,                          // P/A/L/H/S or null
            ];

            $cursor->modify('+1 day');
        }

        return $this->response->withType('application/json')
            ->withStringBody(json_encode([
                'status'       => true,
                'enrollmentId' => $enrollmentId,
                'from'         => $startDate->format('d M Y'),
                'to'           => $endDate->format('d M Y'),
                'summary'      => $summary,
                'days'         => $days,
            ]));
    }

    /**
     * GET /StudentApi/getLinkedStudents
     *
     * Returns all active student enrollments that share the same mobile number
     * as the logged-in student/parent.  Used by the multi-child parent portal
     * to let a parent switch between their children's dashboards.
     *
     * Response: { status: true, data: [ { enrollment_id, student_name,
     *   class_name, section_name, session_name, roll_number } ] }
     */
    public function getLinkedStudents()
    {
        $this->request->allowMethod(['get']);
        $db           = ConnectionManager::get('default');
        $clientCode   = $this->request->getAttribute('jwt_client_code');
        // jwt_user may be empty for parent tokens; fall back to the header sent by the app
        $jwtUser      = $this->request->getAttribute('jwt_user')
                     ?: $this->request->getHeaderLine('ssmsUserName');
        $jwtRole      = strtolower(trim((string)$this->request->getAttribute('jwt_role')));
        $enrollmentId = $this->request->getHeaderLine('ssmsEnrollmentId');


        if (!$clientCode || !$jwtUser) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Unauthorized']));
        }

        // Step 1 — resolve mobile number based on role
        $mobileNumber = null;

        if ($jwtRole === 'parent') {
            // Parent's username IS their 10-digit mobile number (set during registration).
            // Use it directly — avoids relying on mobile_number column which may be blank
            // for older or manually-created accounts.
            // Try the stored mobile_number first (full number with country code); if blank,
            // fall back to the username itself (which is last-10-digits).
            $userRows = $db->execute("
                SELECT mobile_number
                FROM   sawera_ssms_users
                WHERE  ssms_user_name   = ?
                  AND  ssms_client_code = ?
                LIMIT 1
            ", [$jwtUser, $clientCode])->fetchAll('assoc');

            $storedMobile = $userRows[0]['mobile_number'] ?? null;
            // Use stored mobile if present; otherwise fall back to username (= last 10 digits)
            $mobileNumber = ($storedMobile && strlen(preg_replace('/\D/', '', $storedMobile)) >= 7)
                          ? $storedMobile
                          : $jwtUser;

        } else {
            // Student — resolve mobile via their enrollment record
            if (!$enrollmentId) {
                return $this->response->withType('application/json')
                    ->withStringBody(json_encode(['status' => true, 'data' => []]));
            }
            $mobRows = $db->execute("
                SELECT r.mobile_number
                FROM   ssms_student_enrollment   sse
                JOIN   ssms_student_registration r
                    ON r.registration_id  = sse.registration_id
                WHERE  sse.enrollment_id    = ?
                  AND  sse.ssms_client_code = ?
                LIMIT 1
            ", [$enrollmentId, $clientCode])->fetchAll('assoc');

            $mobileNumber = $mobRows[0]['mobile_number'] ?? null;
        }

        if (empty($mobileNumber)) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => true, 'data' => []]));
        }

        // Strip non-digits and use last 10 for LIKE match (MySQL 5.7 compatible)
        $last10 = substr(preg_replace('/\D/', '', $mobileNumber), -10);

        if (strlen($last10) < 6) {
            return $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => true, 'data' => []]));
        }

        // Step 2 — find ALL enrollments sharing that mobile
        $rows = $db->execute("
            SELECT
                sse.enrollment_id,
                TRIM(CONCAT(
                    r.student_first_name, ' ',
                    COALESCE(NULLIF(TRIM(r.student_last_name), ''), '')
                )) AS student_name,
                c.class_name,
                sec.section_name,
                sess.session_name,
                sse.roll_number
            FROM   ssms_student_enrollment     sse
            JOIN   ssms_student_registration   r
                ON r.registration_id  = sse.registration_id
            LEFT JOIN ssms_classes   c    ON c.class_id           = sse.class_id
                                          AND c.ssms_client_code  = sse.ssms_client_code
            LEFT JOIN ssms_sections  sec  ON sec.section_id        = sse.section_id
                                          AND sec.ssms_client_code = sse.ssms_client_code
            LEFT JOIN ssms_sessions  sess ON sess.session_id        = sse.session_id
                                          AND sess.ssms_client_code = sse.ssms_client_code
            WHERE  r.mobile_number     LIKE ?
              AND  sse.ssms_client_code = ?
              AND  sse.status           = 'active'
            ORDER BY c.class_name, sec.section_name
        ", ['%' . $last10, $clientCode])->fetchAll('assoc');


        return $this->response->withType('application/json')
            ->withStringBody(json_encode(['status' => true, 'data' => $rows]));
    }

    // =========================================================================
    // POST /StudentApi/updateRollNumber
    // Update roll number for a single enrollment.
    // Body: { enrollment_id, roll_number }
    // =========================================================================
    public function updateRollNumber(): void
    {
        $this->request->allowMethod(['post']);

        // ── Role check ───────────────────────────────────────────────────────
        $role = strtolower(trim((string)$this->request->getHeaderLine('ssmsUserRole')));
        if (!in_array($role, ['admin', 'owner'], true)) {
            $this->response = $this->response->withStatus(403);
            $this->set(['status' => false, 'message' => 'Access denied. Admin or owner only.']);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
            return;
        }

        // ── Client code ──────────────────────────────────────────────────────
        $clientCode = $this->request->getAttribute('jwt_client_code')
                   ?? $this->request->getHeaderLine('ssmsClientCode')
                   ?? '';
        if (empty($clientCode)) {
            $this->response = $this->response->withStatus(401);
            $this->set(['status' => false, 'message' => 'Client code missing.']);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
            return;
        }

        // ── Parse body ───────────────────────────────────────────────────────
        $body         = $this->request->getData();
        $enrollmentId = trim((string)($body['enrollment_id'] ?? ''));
        $rollNumber   = trim((string)($body['roll_number']   ?? ''));

        if (empty($enrollmentId)) {
            $this->response = $this->response->withStatus(422);
            $this->set(['status' => false, 'message' => 'enrollment_id is required.']);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
            return;
        }

        try {
            $table      = $this->getTableLocator()->get('SsmsStudentEnrollment');
            $enrollment = $table->find()
                ->select(['enrollment_id'])
                ->where(['enrollment_id' => $enrollmentId, 'ssms_client_code' => $clientCode])
                ->first();

            if (!$enrollment) {
                $this->response = $this->response->withStatus(404);
                $this->set(['status' => false, 'message' => "Enrollment not found: {$enrollmentId}"]);
                $this->viewBuilder()->setOption('serialize', ['status', 'message']);
                return;
            }

            $entity = $table->patchEntity($enrollment, ['roll_number' => $rollNumber]);
            if (!$table->save($entity)) {
                $this->response = $this->response->withStatus(500);
                $this->set(['status' => false, 'message' => 'Failed to save roll number.', 'errors' => $entity->getErrors()]);
                $this->viewBuilder()->setOption('serialize', ['status', 'message', 'errors']);
                return;
            }

            $this->set(['status' => true, 'message' => 'Roll number updated.', 'enrollment_id' => $enrollmentId, 'roll_number' => $rollNumber]);
            $this->viewBuilder()->setOption('serialize', ['status', 'message', 'enrollment_id', 'roll_number']);

        } catch (\Exception $e) {
            \Cake\Log\Log::error('updateRollNumber: ' . $e->getMessage());
            $this->response = $this->response->withStatus(500);
            $this->set(['status' => false, 'message' => 'Server error: ' . $e->getMessage()]);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
        }
    }

    // =========================================================================
    // POST /StudentApi/updateRollNumbers
    // Bulk-update roll numbers. Body: { rolls: [{ enrollment_id, roll_number }] }
    // =========================================================================
    public function updateRollNumbers(): void
    {
        $this->request->allowMethod(['post']);

        // ── Role check ───────────────────────────────────────────────────────
        $role = strtolower(trim((string)$this->request->getHeaderLine('ssmsUserRole')));
        if (!in_array($role, ['admin', 'owner'], true)) {
            $this->response = $this->response->withStatus(403);
            $this->set(['status' => false, 'message' => 'Access denied. Admin or owner only.']);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
            return;
        }

        // ── Client code ──────────────────────────────────────────────────────
        $clientCode = $this->request->getAttribute('jwt_client_code')
                   ?? $this->request->getHeaderLine('ssmsClientCode')
                   ?? '';
        if (empty($clientCode)) {
            $this->response = $this->response->withStatus(401);
            $this->set(['status' => false, 'message' => 'Client code missing.']);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
            return;
        }

        // ── Parse body ───────────────────────────────────────────────────────
        $body = $this->request->getData();
        $rolls = $body['rolls'] ?? [];

        if (empty($rolls) || !is_array($rolls)) {
            $this->response = $this->response->withStatus(422);
            $this->set(['status' => false, 'message' => 'rolls array is required.']);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
            return;
        }

        try {
            $table   = $this->getTableLocator()->get('SsmsStudentEnrollment');
            $updated = 0;
            $failed  = [];

            foreach ($rolls as $item) {
                $enrollmentId = trim((string)($item['enrollment_id'] ?? ''));
                $rollNumber   = trim((string)($item['roll_number']   ?? ''));

                if (empty($enrollmentId)) continue;

                $enrollment = $table->find()
                    ->select(['enrollment_id'])
                    ->where(['enrollment_id' => $enrollmentId, 'ssms_client_code' => $clientCode])
                    ->first();

                if (!$enrollment) {
                    $failed[] = $enrollmentId;
                    continue;
                }

                $entity = $table->patchEntity($enrollment, ['roll_number' => $rollNumber]);
                if ($table->save($entity)) {
                    $updated++;
                } else {
                    $failed[] = $enrollmentId;
                }
            }

            $this->set([
                'status'  => true,
                'message' => "{$updated} roll number(s) updated." . (count($failed) ? ' Failed: ' . implode(', ', $failed) : ''),
                'updated' => $updated,
                'failed'  => $failed,
            ]);
            $this->viewBuilder()->setOption('serialize', ['status', 'message', 'updated', 'failed']);

        } catch (\Exception $e) {
            \Cake\Log\Log::error('updateRollNumbers: ' . $e->getMessage());
            $this->response = $this->response->withStatus(500);
            $this->set(['status' => false, 'message' => 'Server error: ' . $e->getMessage()]);
            $this->viewBuilder()->setOption('serialize', ['status', 'message']);
        }
    }
}