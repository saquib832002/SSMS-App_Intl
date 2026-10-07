<?PHP
namespace App\Controller;

use Cake\Datasource\ConnectionManager; 
use App\Controller\AppController;
use Cake\Log\Log;

  class DashboardsController extends AppController {
	  
	  public function initialize(): void
    {
        parent::initialize();

        // Optional: any components specific to this controller
        $this->loadComponent('Flash');
    }
	  
	  public function index() {
		  return $this->redirect(['action' => 'dashboard']);
	  }

    public function dashboard(){
		$secret = \Cake\Core\Configure::read('Jwt.secret');
		log::error("jwt.secrect is :". $secret);
        $session = $this->request->getSession();

        // Superuser gets their own platform dashboard
        if ($session->read('ssms_user_role') === 'superuser') {
            return $this->redirect(['action' => 'superuserDashboard']);
        }
		$connection = ConnectionManager::get('default');
		//========================GET CURRENT Session ===============================
		$getActiveSessionCommand = "SELECT session_id, session_name FROM ssms_sessions where ssms_client_code = '". $session->read('ssms_client_code'). "' and active = 'Yes' and is_current='Y' order by session_id desc limit 1";
		$activeSessions = $connection->execute($getActiveSessionCommand);
		foreach($activeSessions as $activeSession)
			{
				$session_id = $activeSession['session_id'];
			}
		
		
//========================REGISTRATION STATS STARTS ===============================
//============================================================================	
	$cur_session_id = 0;
	$pre_session_id = 0;
	$sessionCommand = "select session_id from ssms_sessions where session_id <= ( select session_id from ssms_sessions where session_id in (select session_id from ssms_sessions Where is_current = 'Y' and ssms_client_code='". $session->read('ssms_client_code'). "') and ssms_client_code='". $session->read('ssms_client_code'). "') and ssms_client_code='". $session->read('ssms_client_code'). "' order by session_id desc limit 2";
	//print_r($sessionCommand);
	$SessionList = $connection->execute($sessionCommand);
	$k = 0;
	if(empty($SessionList))
	{
		$pre_session_id = -1;
		$cur_session_id = 0;
	}
		
	foreach($SessionList as $SessionId)
	{
		
		if($k == 0)
		{
		$cur_session_id = $SessionId['session_id'];
		$k = $k +1;	
		}
		
		else 
			$pre_session_id = $SessionId['session_id'];
	}
	//dump($cur_session_id);
	//dump($pre_session_id);	
	//$command = "SELECT DATE_FORMAT(created,'%Y'),SUM(case when enroll_status = 'enrolled' then 1 else 0 end) as enrolled_count, COUNT(*) as 'TOTAL' FROM ssms_student_registration where ssms_client_code = '". $session->read('ssms_client_code'). "' GROUP By DATE_FORMAT(created,'%Y') order by 1 desc limit 2";
//		if($pre_session_id > 0 && $cur_session_id > 0)
//		{
//			$command = "SELECT ses.session_id, ses.session_name, SUM(case when ses.session_id = ". $pre_session_id. " then 1 else 0 end) as pre_reg_count, SUM(case when ses.session_id = ". $cur_session_id. " then 1 else 0 end) as cur_reg_count FROM ssms_student_registration sr, ssms_sessions ses where sr.ssms_client_code = '". $session->read('ssms_client_code'). "' and ses.session_id <= ". $cur_session_id. " and ses.session_id = sr.session_id GROUP By ses.session_id, ses.session_name";
//		}
//	else if($pre_session_id == 0 && $cur_session_id > 0)
//			$command = "SELECT ses.session_id, ses.session_name, SUM(case when ses.session_id = ". $pre_session_id. " then 1 else 0 end) as pre_reg_count, SUM(case when ses.session_id = ". $cur_session_id. " then 1 else 0 end) as cur_reg_count FROM ssms_student_registration sr, ssms_sessions ses where sr.ssms_client_code = '". $session->read('ssms_client_code'). "' and ses.session_id <= ". $cur_session_id. " and ses.session_id = sr.session_id GROUP By ses.session_id, ses.session_name";
//		else 
		
		if($session->read('ssms_user_role') == 'admin' || $session->read('ssms_user_role') == 'owner')
		{
		$command = "SELECT ses.session_id, ses.session_name, SUM(case when ses.session_id = ". $pre_session_id. " then 1 else 0 end) as pre_reg_count, SUM(case when ses.session_id = ". $cur_session_id. " then 1 else 0 end) as cur_reg_count FROM ssms_student_registration sr, ssms_sessions ses, ssms_branch sb where sr.ssms_client_code = '". $session->read('ssms_client_code'). "' and ses.session_id <= ". $cur_session_id. " and ses.session_id = sr.session_id and sr.branch_id = sb.branch_id  GROUP By ses.session_id, ses.session_name";	
		}
		else
		{
			$command = "SELECT ses.session_id, ses.session_name, SUM(case when ses.session_id = ". $pre_session_id. " then 1 else 0 end) as pre_reg_count, SUM(case when ses.session_id = ". $cur_session_id. " then 1 else 0 end) as cur_reg_count FROM ssms_student_registration sr, ssms_sessions ses where sr.ssms_client_code = '". $session->read('ssms_client_code'). "' and ses.session_id <= ". $cur_session_id. " and ses.session_id = sr.session_id and sr.branch_id = ". $session->read('branch_id') . " GROUP By ses.session_id, ses.session_name";
		}
			
	//$command = "SELECT ses.session_id, ses.session_name,SUM(case when sr.enroll_status = 'enrolled' then 1 else 0 end) as enrolled_count, COUNT(*) as 'TOTAL' FROM ssms_student_registration sr, ssms_sessions ses where sr.ssms_client_code = '". $session->read('ssms_client_code'). "' and sr.session_id <= (SELECT session_id from ssms_sessions where is_current='Y' and ssms_client_code = '". $session->read('ssms_client_code'). "') and ses.session_id = sr.session_id GROUP By ses.session_id, ses.session_name order by 1 desc limit 2";
	//dump($command);
	$totalRegistrationYears = $connection->execute($command);

	// Defaults — overwritten by the loop only if rows exist
	$currentYearRegCount  = 0;
	$previousYearRegCount = 0;

	foreach($totalRegistrationYears as $registrationYears)
	{
		$currentYearRegCount  = (int)($registrationYears['cur_reg_count']  ?? 0);
		$previousYearRegCount = (int)($registrationYears['pre_reg_count'] ?? 0);
	}
		
	if($previousYearRegCount == 0 && $currentYearRegCount == 0)
		 $percIncrease = 0;
	else if($previousYearRegCount ==0 && $currentYearRegCount > 0)
		 $percIncrease = 100;
	else if($previousYearRegCount > 0 && $currentYearRegCount > 0)
		 $percIncrease = ($currentYearRegCount-$previousYearRegCount)/$previousYearRegCount *100;	   
		else
			$percIncrease = 0;	
	
		
//	$totalRegistrationYears = $connection->execute($command);
//	$currentYearRegCount = 0;
//	
//	if(sizeof($totalRegistrationYears) == 0)
//	{
//		$previousYearRegCount = 0;
//		$currentYearRegCount = $registrationYears['TOTAL'];
//		$currentYearEnrollCount = $registrationYears['enroll_count'];
//		$percIncrease = 100;
//	}
//		if(sizeof($totalRegistrationYears) >= 1)
//		{
//			for($i = 1; $i <= sizeof($totalRegistrationYears); ++$i)
//			{
//				foreach($totalRegistrationYears as $registrationYears)
//				{
//					if($i <= 1)
//					{
//						$currentYearRegCount = $registrationYears['TOTAL'];
//
//						$currentYearEnrollCount = $registrationYears['enroll_count'];
//						$previousYearRegCount = 0;
//					}
//					else
//					{
//					   $previousYearRegCount = $registrationYears['TOTAL'];	
//					   $previousYearEnrollCount = $registrationYears['enroll_count'];
//					}
//					//$previousYearRegCount = $registrationYears['TOTAL'];	
//					$i++;
//					
//				}
//			}
//			$percIncrease = 0;
//		}
////dump($previousYearRegCount);
//		
//	 if($previousYearRegCount > 0)
//		 $percIncrease = ($currentYearRegCount-$previousYearRegCount)/$previousYearRegCount *100;
//		else
//		   $percIncrease = 100;
////	 if(sizeof($totalRegistrationYears) <= 0)
////		$percIncrease = 0;
		
		//dump($currentYearRegCount);
		$this->set(compact('percIncrease','currentYearRegCount'));

//========================REGISTRATION STATS ENDS ===============================
//============================================================================	
		
//========================ENROLLEMNT STATS STARTS ===============================
//============================================================================		
		//$commandQuery = "SELECT date_format(se.created,'%Y') , SUM(CASE WHEN sr.student_gender = 'male' THEN 1  ELSE 0 END) as 'MALE', SUM(CASE WHEN sr.student_gender = 'female' THEN 1  ELSE 0 END) as 'FEMALE', COUNT(*) as 'TOTAL' FROM ssms_student_enrollment se, ssms_student_registration sr where sr.registration_id = se.registration_id and se.ssms_client_code = '". $session->read('ssms_client_code'). "' and se.status = 'active' GROUP By date_format(se.created,'%Y') order by 1 desc limit 2";
		if($session->read('ssms_user_role') == 'admin' || $session->read('ssms_user_role') == 'owner')
		{
			$commandQuery = "SELECT ses.session_name , SUM(CASE WHEN sr.student_gender = 'male' THEN 1 ELSE 0 END) as 'MALE', SUM(CASE WHEN sr.student_gender = 'female' THEN 1 ELSE 0 END) as 'FEMALE', COUNT(*) as 'TOTAL' FROM ssms_student_enrollment se, ssms_student_registration sr, ssms_sessions ses where sr.registration_id = se.registration_id and se.ssms_client_code = '". $session->read('ssms_client_code'). "' and se.status = 'active' and se.session_id <= (SELECT session_id from ssms_sessions where is_current='Y' and ssms_client_code = '". $session->read('ssms_client_code'). "') and se.session_id = ses.session_id AND se.branch_id = se.branch_id GROUP By ses.session_name order by 1 desc limit 2";
		}
		else
		$commandQuery = "SELECT ses.session_name , SUM(CASE WHEN sr.student_gender = 'male' THEN 1 ELSE 0 END) as 'MALE', SUM(CASE WHEN sr.student_gender = 'female' THEN 1 ELSE 0 END) as 'FEMALE', COUNT(*) as 'TOTAL' FROM ssms_student_enrollment se, ssms_student_registration sr, ssms_sessions ses where sr.registration_id = se.registration_id and se.ssms_client_code = '". $session->read('ssms_client_code'). "' and se.status = 'active' and se.session_id <= (SELECT session_id from ssms_sessions where is_current='Y' and ssms_client_code = '". $session->read('ssms_client_code'). "') and se.session_id = ses.session_id AND se.branch_id = ". $session->read('branch_id') . " GROUP By ses.session_name order by 1 desc limit 2";
		
		//dump($commandQuery);
		$enrollmentStats = $connection->execute($commandQuery)->fetchAll('assoc');
		$currentYearEnrollCount = 0;
		$previousYearEnrollCount = 0;
			$previousYearBoysCount = 0;
			$previousYearGirlssCount = 0;
			$enrollPercIncrease = 0;
			$currentYearEnrollCount = 0;
			$currentYearBoysCount = 0;
			$currentYearGirlssCount = 0;
			$boysPercent = 0;
			$girlsPercent = 0;
	if(empty($enrollmentStats))
	{
			$previousYearEnrollCount = 0;
			$previousYearBoysCount = 0;
			$previousYearGirlssCount = 0;
			$enrollPercIncrease = 0;
			$currentYearEnrollCount = 0;
			$currentYearBoysCount = 0;
			$currentYearGirlssCount = 0;
			$boysPercent = 0;
			$girlsPercent = 0;
	}
			else if(!empty($enrollmentStats))
			{
				for($i = 1; $i <= count($enrollmentStats); ++$i)
				{
					foreach($enrollmentStats as $enrollYears)
					{
						if($i == 1)
						{
							$currentYearEnrollCount = $enrollYears['TOTAL'];
							$currentYearBoysCount = $enrollYears['MALE'];
							$currentYearGirlssCount = $enrollYears['FEMALE'];
						}
						else
						{
						$previousYearEnrollCount = $enrollYears['TOTAL'];
						$previousYearBoysCount = $enrollYears['MALE'];
						$previousYearGirlssCount = $enrollYears['FEMALE'];

						}
						$i++;

					}
				}
				
		}
		 if($previousYearEnrollCount > 0)
			$enrollPercIncrease = ($currentYearEnrollCount-$previousYearEnrollCount)/$previousYearEnrollCount *100;
			else
				$enrollPercIncrease = 100;
		
		 if($previousYearBoysCount > 0 )
		 	$boysPercent = ($currentYearBoysCount - $previousYearBoysCount)/$previousYearBoysCount * 100;
			else if($previousYearBoysCount == 0 && $currentYearBoysCount > 0 )
				$boysPercent = 100;
			else
				$boysPercent = 0;
		if($previousYearBoysCount > 0)
			$girlsPercent = ($currentYearGirlssCount - $previousYearGirlssCount)/$previousYearGirlssCount * 100;
			else if($previousYearBoysCount == 0 && $currentYearGirlssCount > 0)
				$girlsPercent = 100;
			else
				$girlsPercent = 0;
//	if(sizeof($enrollmentStats) <= 1)
//	{
//			$enrollPercIncrease = 100;
//			$girlsPercent = 100;
//			$boysPercent = 100;
//			//$currentYearBoysCount = 0;
//			//$currentYearGirlssCount = 0;
//	}
//	
		
		$this->set(compact('enrollPercIncrease','currentYearBoysCount', 'currentYearEnrollCount','currentYearBoysCount', 'currentYearGirlssCount', 'boysPercent', 'girlsPercent'));
//========================ENROLLEMNT STATS END ===============================
//============================================================================
		

//========================STAFF STATS STARTS ===============================
//============================================================================	
		
       // $this->loadModel('SsmsStudentEnrollment');
        $this->fetchTable('SsmsStudentEnrollment');
        //get staff count
        
       // $this->loadModel ('SsmsStaff');
       // $staffCount = $this->fetchTable('SsmsStaff')->find('all', array('conditions' => array('ssms_client_code'=>$session->read('ssms_client_code'), 'hired'=>'yes','branch_id'=>$session->read('branch_id'), 'resigned is'=>null )))->count();
		
		$staffCount = $this->fetchTable('SsmsStaff')->find()->where([
			'ssms_client_code' => $session->read('ssms_client_code'),
			'hired' => 'yes',
			'branch_id' => $session->read('branch_id'),
			'resigned IS' => null
    		])->count();
		
        $this->set('staffCount', $staffCount);
        $total_head_count = $currentYearGirlssCount + $currentYearBoysCount + $staffCount;
		$previous_head_count = $previousYearGirlssCount + $currentYearGirlssCount + $staffCount;
		if($previous_head_count == 0 && $total_head_count > 0)
			$headCountPerc = 100;
		else
			if($previous_head_count == 0 && $total_head_count == 0)
				$headCountPerc = 0;
		else
			$headCountPerc = 100;
        $this->set(compact('total_head_count','headCountPerc'));
        /* $studentEnroll = $this->SsmsStudentEnrollment->find('all', array('conditions' => array('ssms_client_code'=>$session->read('ssms_client_code'))));
        $studentEnroll->select(['total' => $studentEnroll->func()->count('enrollment_id'), 'class_id' => 'class_id']);
        $studentEnroll->where(['YEAR(created)' => date('Y')]);
        $studentEnroll->group(['class_id' => 'class_id']);*/
        
        
        
        
        
   
		
	//========================CHART STATS STARTS ===============================
//==============================================================================		
        $studentEnroll = $this->fetchTable('SsmsStudentEnrollment')->find()

            ->where(['SsmsStudentEnrollment.ssms_client_code' => $session->read('ssms_client_code'), 'status'=>'active', 'is_current'=>'Y'])
            ->contain(['SsmsClasses','SsmsSessions']);
        $studentEnroll->select(['total' => $studentEnroll->func()->count('enrollment_id'), 'class_name' => 'class_name']);
       // $studentEnroll->where(['YEAR(created)' => date('Y')]);
        $studentEnroll->group(['class_name' => 'class_name']);
           
        
        $tempArray = array();
        foreach ($studentEnroll as $state) : 
          
     	$temp = array("y" => $state->total , "label" => $state->class_name );
    	array_push($tempArray, $temp);
		
		
    /*$dataPoints = array(
      array("y" => 111 , "label" => "Class-1" ),
       array("y" => 194, "label" => "Class-2" ),
        array("y" => 55, "label" => "Class-3" ),
        array("y" => 99, "label" => "Class-4" ),
        array("y" => 199, "label" => "Class-5" ),
        array("y" => 215, "label" => "Class-6" ),
        array("y" => 453, "label" => "Class-7" )
      );*/
        
   endforeach; 

   $this->set ('dataPoints', $tempArray);

//=========
//		
//	$last2SessionsQuery = "SELECT session_id from ssms_sessions where session_id <= (select session_id from ssms_sessions where is_current='Y') order by 1 desc limit 2";
//	$$session_id1 = 0;
//	$$session_id2 = 0;
//	$last2Sessions = $connection->execute($last2SessionsQuery);	
//		
//	 $i=0;
//		foreach($last2Sessions as $last2Session)
//		{
//			if($i == 0)
//			{
//				$session_id1 = $last2Session['session_id'];
//				++$i;
//			}
//			
//			
//			else
//			$session_id2 = $last2Session['session_id'];
//			}
//	
//		$chartQuery1 = "SELECT ses.session_name, sc.class_name, count(se.enrollment_id) as total from ssms_student_enrollment se, ssms_classes sc, ssms_sessions ses where se.session_id =ses.session_id and se.class_id = sc.class_id and se.session_id = '". $session_id1 . "' group by ses.session_name, sc.class_name ";
//		$chartQuery2 = "SELECT ses.session_name, sc.class_name, count(se.enrollment_id) as total from ssms_student_enrollment se, ssms_classes sc, ssms_sessions ses where se.session_id =ses.session_id and se.class_id = sc.class_id and se.session_id = '". $session_id2 . "' group by ses.session_name, sc.class_name ";
//		
//		$studentEnroll1 = $connection->execute($chartQuery1);
//		$studentEnroll2 = $connection->execute($chartQuery2);
//		dump($studentEnroll1);
//		dump($studentEnroll2);
//		$tempArray1 = array();
//		$tempArray2 = array();
//        foreach ($studentEnroll1 as $state) : 
//        
//     	$temp1 = array("y" => $state['total'] , "label" => $state['class_name'] );
//    	array_push($tempArray1, $temp1);
//	
//		 endforeach; 
//		 
//		foreach ($studentEnroll2 as $state) : 
//        
//     	$temp2 = array("y" => $state['total'] , "label" => $state['class_name'] );
//    	array_push($tempArray2, $temp2);
//	
//		 endforeach;
//		$this->set ('dataPoints1', $tempArray1);
//		$this->set ('dataPoints2', $tempArray2);
	//========================CHART STATS ENDS ===============================
//============================================================================		
		
	
	//========================Absentee list STARTS ===============================
//============================================================================			
    //coverted time zone - DB time in CT    
	$query = "select student_first_name, enrollment_id, class_name from (SELECT sr.student_first_name, se.enrollment_id, sc.class_name  from ssms_student_registration sr, ssms_student_enrollment se, ssms_classes sc WHERE sr.registration_id = se.registration_id AND se.class_id = sc.class_id AND se.enrollment_id in (select att.enrollment_id from student_attendance att where attendance = 'A' and attendance_date=date_format( CONVERT_TZ(created, '+00:00', '-09:30'), '%Y-%m-%d')) AND se.ssms_client_code = '".$session->read('ssms_client_code'). "' AND se.status = 'active' UNION SELECT sr.student_first_name, se.enrollment_id, sc.class_name  from ssms_student_registration sr, ssms_student_enrollment se, ssms_classes sc WHERE sr.registration_id = se.registration_id AND se.class_id = sc.class_id AND se.enrollment_id not in (select enrollment_id from student_attendance WHERE attendance_date=date_format( CONVERT_TZ(created, '+00:00', '-09:30'), '%Y-%m-%d')) AND se.ssms_client_code = '".$session->read('ssms_client_code')."' AND se.status = 'active') tab order by student_first_name limit 6";
	$absentList = $connection->execute($query);	
	$this->set(compact('absentList'));	
	//dump($query);
    
	//========================= School Toppers ======================
	  $query = "SELECT sr.student_first_name, sm.enrollment_id, ses.session_name, sc.class_name, sc.class_id, sec.section_name, sec.section_id,sum(total_marks) as 'total_obtained' , sum(smm.max_marks) as 'max_marks', sum(total_marks)/sum(smm.max_marks) *100 as 'percentage' FROM ssms_marks sm, ssms_max_marks smm, ssms_classes sc, ssms_sessions ses, ssms_sections sec, ssms_student_enrollment se, ssms_student_registration sr WHERE se.enrollment_id = sm.enrollment_id and se.registration_id = sr.registration_id and sm.class_id=smm.class_id and sm.session_id = ses.session_id and sm.section_id = sec.section_id and sc.class_id = sec.class_id and smm.subject_id = sm.subject_id and sm.ssms_client_code = '". $session->read('ssms_client_code') . "' and sm.session_id = 1 and sm.exam_id = 1 and sr.branch_id = 1 GROUP by sr.student_first_name, enrollment_id, session_name, class_name, class_id, section_name, section_id, max_marks order by 9 desc limit 6";
	$studentRanks = $connection->execute($query);
	$this->set(compact('studentRanks'));

	//========================= Upcoming Events & Holidays ======================
	$upcomingEvents = $connection->execute(
		"SELECT event_id, event_title, event_type, event_category, event_date, event_end_date, event_color
		 FROM ssms_school_events
		 WHERE ssms_client_code = ?
		   AND is_public = 1
		   AND (
		         (event_end_date IS NULL  AND event_date >= CURDATE())
		      OR (event_end_date IS NOT NULL AND event_end_date >= CURDATE())
		   )
		 ORDER BY event_date ASC
		 LIMIT 5",
		[$session->read('ssms_client_code')]
	)->fetchAll('assoc');
	$this->set(compact('upcomingEvents'));

	//========================= Recent Notices =================================
	$clientCode = $session->read('ssms_client_code');
	$role       = strtolower((string)$session->read('ssms_user_role'));
	$noticeWhere = "WHERE ssms_client_code = ? AND is_active = 1
	                  AND (expires_at IS NULL OR expires_at >= CURDATE())";
	$noticeParams = [$clientCode];
	if (!in_array($role, ['admin','owner','teacher'], true)) {
	    if ($role === 'student') {
	        $noticeWhere .= " AND target_audience IN ('all','students')";
	    } elseif ($role === 'parent') {
	        $noticeWhere .= " AND target_audience IN ('all','parents')";
	    } else {
	        $noticeWhere .= " AND target_audience IN ('all','staff')";
	    }
	}
	$recentNotices = $connection->execute(
	    "SELECT notice_id, title, category, priority, target_audience, is_pinned, created_at
	     FROM ssms_notices $noticeWhere
	     ORDER BY is_pinned DESC, created_at DESC LIMIT 5",
	    $noticeParams
	)->fetchAll('assoc');
	$this->set(compact('recentNotices'));

	//========================= Recent Gallery Photos ==========================
	$recentGallery = $connection->execute(
	    "SELECT id, file_name, caption, created
	     FROM ssms_school_gallery
	     WHERE ssms_client_code = ? AND status = 'active'
	     ORDER BY created DESC LIMIT 6",
	    [$clientCode]
	)->fetchAll('assoc');
	$this->set(compact('recentGallery'));

	} // end dashboard()

    // ─────────────────────────────────────────────────────────────────────────
    // Superuser Platform Dashboard
    // ─────────────────────────────────────────────────────────────────────────
    public function superuserDashboard()
    {
        $session = $this->request->getSession();
        if ($session->read('ssms_user_role') !== 'superuser') {
            return $this->redirect(['action' => 'dashboard']);
        }

        $db = ConnectionManager::get('default');

        $kpis = $db->execute("
            SELECT
                COUNT(*)                                                                AS total_clients,
                SUM(ssms_client_status = 'active')                                     AS active_clients,
                SUM(ssms_client_status != 'active')                                    AS inactive_clients,
                SUM(ssms_client_expiry_date >= CURDATE()
                    AND ssms_client_expiry_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)) AS expiring_soon
            FROM ssms_clients
        ")->fetch('assoc');

        $userKpi = $db->execute("
            SELECT COUNT(*) AS total_users
            FROM sawera_ssms_users
            WHERE ssms_user_role != 'superuser'
        ")->fetch('assoc');

        $studentKpi = $db->execute("
            SELECT COUNT(*) AS total_students FROM ssms_student_registration
        ")->fetch('assoc');

        $classKpi = $db->execute("
            SELECT COUNT(*) AS total_classes FROM ssms_classes
        ")->fetch('assoc');

        $recentClients = $db->execute("
            SELECT ssms_client_code, ssms_client_header_text, ssms_client_email,
                   ssms_client_status, ssms_client_expiry_date, created
            FROM ssms_clients ORDER BY created DESC LIMIT 10
        ")->fetchAll('assoc');

        $clientStats = $db->execute("
            SELECT
                c.ssms_client_code,
                c.ssms_client_header_text AS school_name,
                c.ssms_client_email,
                c.ssms_client_status,
                c.ssms_client_expiry_date,
                c.created,
                (SELECT COUNT(*) FROM sawera_ssms_users u
                 WHERE u.ssms_client_code = c.ssms_client_code
                   AND u.ssms_user_role != 'superuser')        AS user_count,
                (SELECT COUNT(*) FROM ssms_classes cl
                 WHERE cl.ssms_client_code = c.ssms_client_code) AS class_count,
                (SELECT COUNT(*) FROM ssms_student_registration sr
                 WHERE sr.ssms_client_code = c.ssms_client_code) AS student_count
            FROM ssms_clients c
            ORDER BY c.created DESC
        ")->fetchAll('assoc');

        $monthlyReg = $db->execute("
            SELECT DATE_FORMAT(created,'%b %Y') AS month_label,
                   DATE_FORMAT(created,'%Y-%m') AS month_key,
                   COUNT(*) AS count
            FROM ssms_clients
            WHERE created >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
            GROUP BY month_key, month_label
            ORDER BY month_key ASC
        ")->fetchAll('assoc');

        $inactiveUsers = $db->execute("
            SELECT
                u.ssms_user_name,
                u.ssms_user_firstname,
                u.ssms_user_lastname,
                u.ssms_user_email,
                u.ssms_user_role,
                u.ssms_user_status,
                u.validationStatus,
                u.ssms_client_code,
                c.ssms_client_header_text AS school_name
            FROM sawera_ssms_users u
            LEFT JOIN ssms_clients c ON c.ssms_client_code = u.ssms_client_code
            WHERE u.ssms_user_status != 'active'
              AND u.ssms_user_role   != 'superuser'
            ORDER BY u.ssms_client_code, u.ssms_user_name
        ")->fetchAll('assoc');

        $activeUsers = $db->execute("
            SELECT
                u.ssms_user_name,
                u.ssms_user_firstname,
                u.ssms_user_lastname,
                u.ssms_user_email,
                u.ssms_user_role,
                u.ssms_user_status,
                u.validationStatus,
                u.ssms_client_code,
                c.ssms_client_header_text AS school_name
            FROM sawera_ssms_users u
            LEFT JOIN ssms_clients c ON c.ssms_client_code = u.ssms_client_code
            WHERE u.ssms_user_status = 'active'
              AND u.ssms_user_role   != 'superuser'
            ORDER BY u.ssms_client_code, u.ssms_user_name
        ")->fetchAll('assoc');

        // Support ticket KPIs
        $ticketKpi = $db->execute("
            SELECT
                COUNT(*)                              AS total,
                SUM(status = 'Open')                  AS open_count,
                SUM(status = 'In Progress')           AS in_progress_count,
                SUM(status = 'Resolved')              AS resolved_count
            FROM support_tickets
        ")->fetch('assoc');

        // Recent open/in-progress tickets for dashboard widget
        $openTickets = $db->execute("
            SELECT t.ticket_id, t.ticket_number, t.name, t.email_address,
                   t.problem_description, t.status, t.created,
                   c.ssms_client_header_text AS school_name
            FROM support_tickets t
            LEFT JOIN ssms_clients c ON c.ssms_client_code = t.ssms_client_code
            WHERE t.status IN ('Open', 'In Progress')
            ORDER BY t.ticket_id DESC
            LIMIT 10
        ")->fetchAll('assoc');

        $this->set(compact(
            'kpis', 'userKpi', 'studentKpi', 'classKpi',
            'recentClients', 'clientStats', 'monthlyReg', 'inactiveUsers', 'activeUsers',
            'ticketKpi', 'openTickets'
        ));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Superuser: Toggle user active/inactive
    // POST /admin/toggle-user-status  { username, action: 'activate'|'deactivate' }
    // ─────────────────────────────────────────────────────────────────────────
    public function toggleUserStatus(): void
    {
        $this->autoRender = false;
        $session = $this->request->getSession();
        if ($session->read('ssms_user_role') !== 'superuser') {
            $this->response = $this->response->withStatus(403)
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Forbidden']));
            return;
        }

        $this->request->allowMethod(['post']);
        $body     = json_decode((string)$this->request->getBody(), true) ?? [];
        $username = trim((string)($body['username'] ?? ''));
        $action   = trim((string)($body['action']   ?? ''));   // 'activate' | 'deactivate'

        if (!$username || !in_array($action, ['activate', 'deactivate'])) {
            $this->response = $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Invalid request.']));
            return;
        }

        $db = ConnectionManager::get('default');

        // Prevent touching other superusers
        $target = $db->execute(
            "SELECT ssms_user_role FROM sawera_ssms_users WHERE ssms_user_name = ? LIMIT 1",
            [$username]
        )->fetch('assoc');

        if (!$target) {
            $this->response = $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'User not found.']));
            return;
        }
        if ($target['ssms_user_role'] === 'superuser') {
            $this->response = $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Cannot modify a superuser account.']));
            return;
        }

        if ($action === 'activate') {
            $db->execute(
                "UPDATE sawera_ssms_users
                 SET ssms_user_status = 'active',
                     validationStatus  = 'adminActivated',
                     modified          = NOW()
                 WHERE ssms_user_name = ?",
                [$username]
            );
            $msg = "User '{$username}' has been activated.";
        } else {
            $db->execute(
                "UPDATE sawera_ssms_users
                 SET ssms_user_status = 'Inactive',
                     modified          = NOW()
                 WHERE ssms_user_name = ?",
                [$username]
            );
            $msg = "User '{$username}' has been deactivated.";
        }

        Log::info("SuperUser toggleUserStatus: {$action} → {$username} by " . $session->read('ssms_user_name'));

        $this->response = $this->response->withType('application/json')
            ->withStringBody(json_encode(['status' => true, 'message' => $msg, 'action' => $action]));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Finance Dashboard
    // ─────────────────────────────────────────────────────────────────────────
    public function financeDashboard(): void
    {
        $session = $this->request->getSession();
        $code    = $session->read('ssms_client_code');
        $db      = ConnectionManager::get('default');

        // Active fiscal year
        $fy = $db->execute(
            "SELECT * FROM fin_fiscal_years WHERE ssms_client_code=? AND is_current=1 LIMIT 1",
            [$code]
        )->fetch('assoc');

        if (!$fy) {
            // No FY: pass empty data
            $this->set(compact('fy'));
            return;
        }

        $fyId = $fy['fy_id'];

        // KPIs
        $incomeTotal = (float)($db->execute(
            "SELECT COALESCE(SUM(amount),0) AS t FROM fin_income WHERE ssms_client_code=? AND fy_id=? AND (status IS NULL OR status != 'voided')",
            [$code, $fyId]
        )->fetch('assoc')['t'] ?? 0);

        $expenseTotal = (float)($db->execute(
            "SELECT COALESCE(SUM(amount),0) AS t FROM fin_expenses WHERE ssms_client_code=? AND fy_id=? AND status='approved'",
            [$code, $fyId]
        )->fetch('assoc')['t'] ?? 0);

        $pendingCount = (int)($db->execute(
            "SELECT COUNT(*) AS n FROM fin_expenses WHERE ssms_client_code=? AND fy_id=? AND status='pending'",
            [$code, $fyId]
        )->fetch('assoc')['n'] ?? 0);

        // Monthly chart: last 6 months
        $monthlyData = $db->execute("
            SELECT m.month_key,
                   COALESCE(i.income,0)  AS income,
                   COALESCE(e.expense,0) AS expense
            FROM (
              SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL n MONTH),'%Y-%m') AS month_key
              FROM (SELECT 0 n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5) nums
            ) m
            LEFT JOIN (
              SELECT DATE_FORMAT(income_date,'%Y-%m') AS mk, SUM(amount) AS income
              FROM fin_income WHERE ssms_client_code=? AND fy_id=? AND (status IS NULL OR status != 'voided') GROUP BY mk
            ) i ON i.mk = m.month_key
            LEFT JOIN (
              SELECT DATE_FORMAT(expense_date,'%Y-%m') AS mk, SUM(amount) AS expense
              FROM fin_expenses WHERE ssms_client_code=? AND fy_id=? AND status='approved' GROUP BY mk
            ) e ON e.mk = m.month_key
            ORDER BY m.month_key ASC
        ", [$code, $fyId, $code, $fyId])->fetchAll('assoc');

        // Recent income (5)
        $recentIncome = $db->execute(
            "SELECT i.income_date, i.receipt_no, i.income_type, i.amount, i.payer_name, a.account_name
             FROM fin_income i JOIN fin_chart_of_accounts a ON a.account_id=i.account_id
             WHERE i.ssms_client_code=? AND i.fy_id=? AND (i.status IS NULL OR i.status='active') ORDER BY i.income_id DESC LIMIT 5",
            [$code, $fyId]
        )->fetchAll('assoc');

        // Recent expenses (5)
        $recentExpenses = $db->execute(
            "SELECT e.expense_date, e.voucher_no, e.expense_type, e.amount, e.payee_name, e.status, a.account_name
             FROM fin_expenses e JOIN fin_chart_of_accounts a ON a.account_id=e.account_id
             WHERE e.ssms_client_code=? AND e.fy_id=? ORDER BY e.expense_id DESC LIMIT 5",
            [$code, $fyId]
        )->fetchAll('assoc');

        $netSurplus = $incomeTotal - $expenseTotal;

        // Top 5 expense categories
        $topExpenses = $db->execute(
            "SELECT a.account_name, COALESCE(SUM(e.amount),0) AS total
             FROM fin_expenses e JOIN fin_chart_of_accounts a ON a.account_id=e.account_id
             WHERE e.ssms_client_code=? AND e.fy_id=? AND e.status='approved'
             GROUP BY a.account_name ORDER BY total DESC LIMIT 5",
            [$code, $fyId]
        )->fetchAll('assoc');

        // Bank positions
        $bankPositions = $db->execute(
            "SELECT bank_name, account_type, current_balance
             FROM fin_bank_accounts WHERE ssms_client_code=? AND is_active=1
             ORDER BY is_default DESC, bank_name",
            [$code]
        )->fetchAll('assoc');
        $totalCash = array_sum(array_column($bankPositions, 'current_balance'));

        // Budget utilization
        $budgetUtil = $db->execute(
            "SELECT a.account_name,
                    COALESCE(SUM(bl.budgeted_amount),0) AS budgeted,
                    COALESCE(SUM(jl.debit_amount),0)    AS actual
             FROM fin_budget_lines bl
             JOIN fin_budgets b ON b.budget_id=bl.budget_id
             JOIN fin_chart_of_accounts a ON a.account_id=bl.account_id
             LEFT JOIN fin_journal_lines jl ON jl.account_id=bl.account_id
             LEFT JOIN fin_journal_entries je ON je.journal_id=jl.journal_id
                   AND je.ssms_client_code=? AND je.fy_id=? AND je.source_type='expense'
             WHERE b.ssms_client_code=? AND b.fy_id=? AND b.is_active=1
             GROUP BY bl.account_id, a.account_name
             HAVING COALESCE(SUM(bl.budgeted_amount),0) > 0
             ORDER BY COALESCE(SUM(jl.debit_amount),0)/COALESCE(SUM(bl.budgeted_amount),1) DESC LIMIT 5",
            [$code, $fyId, $code, $fyId]
        )->fetchAll('assoc');

        $this->set(compact(
            'fy','incomeTotal','expenseTotal','netSurplus','pendingCount',
            'monthlyData','recentIncome','recentExpenses',
            'topExpenses','bankPositions','totalCash','budgetUtil'
        ));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Superuser: Send marketing campaign email to clients
    // POST /admin/send-marketing-email
    // Body JSON: { target: 'all'|'active'|'inactive', android_link: '...' }
    // ─────────────────────────────────────────────────────────────────────────
    public function sendMarketingEmail(): void
    {
        $this->autoRender = false;
        $session = $this->request->getSession();

        if ($session->read('ssms_user_role') !== 'superuser') {
            $this->response = $this->response->withStatus(403)
                ->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Forbidden']));
            return;
        }

        $this->request->allowMethod(['post']);
        $body        = json_decode((string)$this->request->getBody(), true) ?? [];
        $target      = trim((string)($body['target']       ?? 'all'));
        $androidLink = trim((string)($body['android_link'] ?? ''));

        if (!in_array($target, ['all', 'active', 'inactive', 'single'])) {
            $this->response = $this->response->withType('application/json')
                ->withStringBody(json_encode(['status' => false, 'message' => 'Invalid target.']));
            return;
        }

        // Single-client mode: email and name passed directly in request body
        if ($target === 'single') {
            $singleEmail = trim((string)($body['email'] ?? ''));
            $singleName  = trim((string)($body['name']  ?? 'School Administrator'));
            $clients = empty($singleEmail)
                ? []
                : [['ssms_client_email' => $singleEmail, 'ssms_client_header_text' => $singleName]];
        } else {
            $db  = ConnectionManager::get('default');
            $sql = "SELECT ssms_client_header_text, ssms_client_email
                    FROM ssms_clients
                    WHERE ssms_client_email IS NOT NULL AND ssms_client_email != ''";
            if ($target === 'active') {
                $sql .= " AND ssms_client_status = 'active'";
            } elseif ($target === 'inactive') {
                $sql .= " AND ssms_client_status != 'active'";
            }
            $clients = $db->execute($sql)->fetchAll('assoc');
        }

        $sent   = 0;
        $failed = 0;
        $errors = [];

        foreach ($clients as $client) {
            $email = trim((string)($client['ssms_client_email'] ?? ''));
            $name  = trim((string)($client['ssms_client_header_text'] ?? 'School Administrator'));
            if (empty($email)) {
                continue;
            }
            try {
                (new \App\Mailer\MarketingMailer())->send('campaign', [$email, $name, $androidLink]);
                $sent++;
                \Cake\Log\Log::error('MarketingMailer: OK sent to ' . $email);
            } catch (\Throwable $e) {
                $failed++;
                $msg = $e->getMessage() . ' | ' . get_class($e);
                $errors[] = $email . ': ' . $msg;
                \Cake\Log\Log::error('MarketingMailer FAILED for ' . $email . ': ' . $msg);
                \Cake\Log\Log::error('MarketingMailer trace: ' . substr($e->getTraceAsString(), 0, 800));
            }
        }

        $this->response = $this->response->withType('application/json')
            ->withStringBody(json_encode([
                'status'  => true,
                'sent'    => $sent,
                'failed'  => $failed,
                'total'   => count($clients),
                'errors'  => array_slice($errors, 0, 5), // cap to first 5
            ]));
    }

} // end class DashboardsController
?>
