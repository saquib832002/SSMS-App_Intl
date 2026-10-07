<?php
/**
 * Routes configuration.
 *
 * In this file, you set up routes to your controllers and their actions.
 * Routes are very important mechanism that allows you to freely connect
 * different URLs to chosen controllers and their actions (functions).
 *
 * It's loaded within the context of `Application::routes()` method which
 * receives a `RouteBuilder` instance `$routes` as method argument.
 *
 * CakePHP(tm) : RStudentApid Development Framework (https://cakephp.org)
 * Copyright (c) Cake Software Foundation, Inc. (https://cakefoundation.org)
 *
 * Licensed under The MIT License
 * For full copyright and license information, please see the LICENSE.txt
 * Redistributions of files must retain the above copyright notice.
 *
 * @copyright     Copyright (c) Cake Software Foundation, Inc. (https://cakefoundation.org)
 * @link          https://cakephp.org CakePHP(tm) Project
 * @license       https://opensource.org/licenses/mit-license.php MIT License
 */

use Cake\Routing\Route\DashedRoute;
use Cake\Routing\RouteBuilder;

/*
 * This file is loaded in the context of the `Application` class.
 * So you can use `$this` to reference the application class instance
 * if required.
 */
return function (RouteBuilder $routes): void {
    /*
     * The default class to use for all routes
     *
     * The following route classes are supplied with CakePHP and are appropriate
     * to set as the default:
     *
     * - Route
     * - InflectedRoute
     * - DashedRoute
     *
     * If no call is made to `Router::defaultRouteClass()`, the class used is
     * `Route` (`Cake\Routing\Route\Route`)
     *
     * Note that `Route` does not do any inflections on URLs which will result in
     * inconsistently cased URLs when used with `{plugin}`, `{controller}` and
     * `{action}` markers.
     */
    //$routes->setRouteClass(DashedRoute::class);
    $routes->setRouteClass(\Cake\Routing\Route\Route::class);

    $routes->scope('/', function (RouteBuilder $builder): void {
        /*
         * Here, we are connecting '/' (base path) to a controller called 'Pages',
         * its action called 'display', and we pass a param to select the view file
         * to use (in this case, templates/Pages/home.php)...
         */

        //$builder->connect('/', ['controller' => 'Pages', 'action' => 'display', 'home']);
        $builder->connect('/', ['controller' => 'SsmsClients', 'action' => 'landing']);

        // ── Student Portal ────────────────────────────────────────────────────
        $builder->connect('/StudentPortal/register',   ['controller' => 'StudentPortal', 'action' => 'register']);
        $builder->connect('/StudentPortal/dashboard',  ['controller' => 'StudentPortal', 'action' => 'dashboard']);
        $builder->connect('/StudentPortal/attendance',  ['controller' => 'StudentPortal', 'action' => 'attendance']);
        $builder->connect('/StudentPortal/results',     ['controller' => 'StudentPortal', 'action' => 'results']);
        $builder->connect('/StudentPortal/timetable',   ['controller' => 'StudentPortal', 'action' => 'timetable']);
        $builder->connect('/StudentPortal/logout',     ['controller' => 'StudentPortal', 'action' => 'logout']);
        $builder->connect('/DashboardServiceApi/dashboard', ['controller' => 'DashboardServiceApi', 'action' => 'dashboard']);
        $builder->connect('/Dashboards/superuserDashboard', ['controller' => 'Dashboards', 'action' => 'superuserDashboard']);
// config/routes.php
        $builder->connect('/HostelServiceApi/debugJwt', ['controller' => 'HostelServiceApi', 'action' => 'debugJwt']);
     
        $builder->connect('/StudentApi/getClasses', ['controller' => 'StudentApi', 'action' => 'getClasses']);
        $builder->connect('/StudentApi/getSessions', ['controller' => 'StudentApi', 'action' => 'getSessions']);
        $builder->connect('/StudentApi/getBranches', ['controller' => 'StudentApi', 'action' => 'getBranches']);
        $builder->connect('/StudentApi/registerStudent', ['controller' => 'StudentApi', 'action' => 'registerStudent']);
        $builder->connect('/StudentApi/getRegisteredStudens', ['controller' => 'StudentApi', 'action' => 'getRegisteredStudens']);
        $builder->connect('/StudentApi/getRegisteredStudens11', ['controller' => 'StudentApi', 'action' => 'getRegisteredStudens11']);
        $builder->connect('/StudentApi/getEnrolledStudents', ['controller' => 'StudentApi', 'action' => 'getEnrolledStudents']);
        $builder->connect('StudentApi/students', ['controller' => 'StudentApi', 'action' => 'students', '_method' => 'GET']);
        $builder->connect('StudentApi/fetchStudentByRegId/:id', ['controller' => 'StudentApi', 'action' => 'fetchStudentByRegId', '_method' => 'GET'])->setPass(['id']);
        $builder->connect('StudentApi/updateStudent/:id', ['controller' => 'StudentApi', 'action' => 'updateStudent', '_method' => 'PUT'])->setPass(['id']);
        $builder->connect('StudentApi/getSections', ['controller' => 'StudentApi', 'action' => 'getSections']);
        $builder->connect('StudentApi/enrollStudent', ['controller' => 'StudentApi', 'action' => 'enrollStudent']);
        $builder->connect('/StudentApi/getStudentsaAttendance', ['controller' => 'StudentApi', 'action' => 'getStudentsaAttendance']);
        $builder->connect('/StudentApi/saveAttendance', [ 'controller' => 'StudentApi', 'action' => 'saveAttendance' ]);
        $builder->connect('/StudentApi/uploadStudentPhoto', [ 'controller' => 'StudentApi', 'action' => 'uploadStudentPhoto' ]);
        $builder->get('/StudentApi/getMonthlyAttendance', ['controller' => 'StudentApi', 'action' => 'getMonthlyAttendance']);
        $builder->get('/StudentApi/getRecentAttendance', ['controller' => 'StudentApi', 'action' => 'getRecentAttendance']);
        $builder->get('/StudentApi/getLinkedStudents', ['controller' => 'StudentApi', 'action' => 'getLinkedStudents']);
        $builder->post('/StudentApi/updateRollNumber',  ['controller' => 'StudentApi', 'action' => 'updateRollNumber']);
        $builder->post('/StudentApi/updateRollNumbers', ['controller' => 'StudentApi', 'action' => 'updateRollNumbers']);
     //    Fee service
        $builder->connect('FeeApi/getFeeItems', ['controller' => 'FeeApi', 'action' => 'getFeeItems', '_method' => 'GET']);
        $builder->connect('FeeApi/createFeeItem', ['controller' => 'FeeApi', 'action' => 'createFeeItem', '_method' => 'POST']);
        $builder->connect('FeeApi/updateFeeItem/:id', ['controller' => 'FeeApi', 'action' => 'updateFeeItem', '_method' => 'PUT'])->setPass(['id']);
        $builder->connect('FeeApi/fee-items/:id', ['controller' => 'FeeApi', 'action' => 'updateFeeItem', '_method' => ['PUT', 'PATCH']])->setPass(['id']);
        $builder->connect('FeeApi/getClassFeeStructure', ['controller' => 'FeeApi', 'action' => 'getClassFeeStructure', '_method' => 'GET']);
        $builder->connect('FeeApi/saveClassFeeStructure', ['controller' => 'FeeApi', 'action' => 'saveClassFeeStructure', '_method' => 'POST']);
        $builder->connect('FeeApi/deactivateFeeItem/:id', ['controller' => 'FeeApi', 'action' => 'deactivateFeeItem', '_method' => 'PATCH'])->setPass(['id']);
        $builder->connect('FeeApi/deleteFeeItem/:id', ['controller' => 'FeeApi', 'action' => 'deleteFeeItem', '_method' => 'DELETE'])->setPass(['id']);
        $builder->connect('FeeApi/getDueFees/:id', ['controller' => 'FeeApi', 'action' => 'getDueFees', '_method' => 'GET'])->setPass(['id']);
        $builder->connect('FeeApi/collecFee/', ['controller' => 'FeeApi', 'action' => 'deleteFeeItem', '_method' => 'POST']);

        $builder->connect('FeeApi/fetchStudentFeeDue/:id', ['controller' => 'FeeApi', 'action' => 'fetchStudentFeeDue', '_method' => 'GET'])->setPass(['id']);
        $builder->connect('FeeApi/payStudentFees/', ['controller' => 'FeeApi', 'action' => 'payStudentFees', '_method' => 'POST']);
        $builder->connect('FeeApi/sendReceiptEmail/', ['controller' => 'FeeApi', 'action' => 'sendReceiptEmail', '_method' => 'POST']);
        $builder->connect('FeeApi/getDemandSlip/', ['controller' => 'FeeApi', 'action' => 'getDemandSlip', '_method' => 'POST']);
        $builder->connect('FeeApi/getPendingCollections', ['controller'=>'FeeApi','action'=>'getPendingCollections']);
        $builder->connect('FeeApi/approveCollections',   ['controller'=>'FeeApi','action'=>'approveCollections']);
        $builder->connect('/FeeApi/getEnrolledStudents', ['controller' => 'FeeApi', 'action' => 'getEnrolledStudents']);

     //setup     
        $builder->connect('/SetupServiceApi/getBranches', ['controller' => 'SetupServiceApi', 'action' => 'getBranches', '_method' => 'GET']);
        $builder->connect('/SetupServiceApi/createBranch', ['controller' => 'SetupServiceApi', 'action' => 'createBranch', '_method' => 'POST']);
        $builder->connect('/SetupServiceApi/updateBranch/:branchId', ['controller' => 'SetupServiceApi', 'action' => 'updateBranch', '_method' => 'PUT'], [
         'pass' => ['branchId'],
         'branchId' => '\\d+',
          ]);
        $builder->connect('/SetupServiceApi/deleteBranch/:branchId', ['controller' => 'SetupServiceApi', 'action' => 'deleteBranch', '_method' => 'DELETE'], [
          'pass' => ['branchId'],
          'branchId' => '\\d+',
          ]);
        $builder->connect('/SetupServiceApi/getClasses', ['controller' => 'SetupServiceApi', 'action' => 'getClasses', '_method' => 'GET']);
        $builder->connect('/SetupServiceApi/createClass', ['controller' => 'SetupServiceApi', 'action' => 'createClass', '_method' => 'POST']);
        $builder->connect('/SetupServiceApi/updateClass/:classId', ['controller' => 'SetupServiceApi', 'action' => 'updateClass', '_method' => 'PUT'], [
         'pass' => ['classId'],
         'classId' => '\\d+',
          ]);
        $builder->connect('/SetupServiceApi/deleteClass/:classId', ['controller' => 'SetupServiceApi', 'action' => 'deleteClass', '_method' => 'DELETE'], [
          'pass' => ['classId'],
          'classId' => '\\d+',
          ]);
        $builder->connect('/SetupServiceApi/getSections', ['controller' => 'SetupServiceApi', 'action' => 'getSections', '_method' => 'GET']);
        $builder->connect('/SetupServiceApi/createSection', ['controller' => 'SetupServiceApi', 'action' => 'createSection', '_method' => 'POST']);
        $builder->connect('/SetupServiceApi/updateSection/:sectionId', ['controller' => 'SetupServiceApi', 'action' => 'updateSection', '_method' => 'PUT'], [
         'pass' => ['sectionId'],
         'classId' => '\\d+',
          ]);
        $builder->connect('/SetupServiceApi/deleteSection/:sectionId', ['controller' => 'SetupServiceApi', 'action' => 'deleteSection', '_method' => 'DELETE'], [
          'pass' => ['sectionId'],
          'classId' => '\\d+',
          ]);
        $builder->connect('/SetupServiceApi/getSessions',          ['controller'=>'SetupServiceApi','action'=>'getSessions']);
        $builder->connect('/SetupServiceApi/createSession',        ['controller'=>'SetupServiceApi','action'=>'createSession']);
        $builder->connect('/SetupServiceApi/updateSession/:id',    ['controller'=>'SetupServiceApi','action'=>'updateSession'])->setPass(['id']);
        $builder->connect('/SetupServiceApi/deleteSession/:id',    ['controller'=>'SetupServiceApi','action'=>'deleteSession'])->setPass(['id']);
        $builder->connect('/SetupServiceApi/getUsers',          ['controller'=>'SetupServiceApi','action'=>'getUsers']);

     //user services
         $builder->connect('/UserServiceApi/login', ['controller' => 'UserServiceApi', 'action' => 'login']);
         $builder->connect('/UserServiceApi/createTrialUser', ['controller' => 'UserServiceApi', 'action' => 'createTrialUser', '_method' => 'POST']);
         $builder->connect('/UserServiceApi/sendForgotPasswordCode', ['controller' => 'UserServiceApi', 'action' => 'sendForgotPasswordCode', '_method' => 'POST']);
         $builder->connect('/UserServiceApi/verifyForgotPasswordCode', ['controller' => 'UserServiceApi', 'action' => 'verifyForgotPasswordCode', '_method' => 'POST']);
         $builder->connect('/UserServiceApi/resetPassword', ['controller' => 'UserServiceApi', 'action' => 'resetPassword', '_method' => 'POST']);
         $builder->connect('/UserServiceApi/registerTrialUser', ['controller' => 'UserServiceApi', 'action' => 'registerTrialUser', '_method' => 'POST']);
         // ── Subscription billing (phase 2) ──────────────────────────────────
         $builder->connect('/SubscriptionApi/getPlans',              ['controller'=>'SubscriptionApi','action'=>'getPlans',              '_method'=>'GET']);
         $builder->connect('/SubscriptionApi/getSubscription',       ['controller'=>'SubscriptionApi','action'=>'getSubscription',       '_method'=>'GET']);
         $builder->connect('/SubscriptionApi/createCheckoutSession', ['controller'=>'SubscriptionApi','action'=>'createCheckoutSession', '_method'=>'POST']);
         $builder->connect('/SubscriptionApi/createPortalSession',   ['controller'=>'SubscriptionApi','action'=>'createPortalSession',   '_method'=>'POST']);
         $builder->connect('/SubscriptionApi/stripeWebhook',         ['controller'=>'SubscriptionApi','action'=>'stripeWebhook',         '_method'=>'POST']);
         $builder->connect('/billing',          ['controller'=>'Billing','action'=>'index',    '_method'=>'GET']);
         $builder->connect('/billing/checkout', ['controller'=>'Billing','action'=>'checkout', '_method'=>'POST']);
         $builder->connect('/billing/portal',   ['controller'=>'Billing','action'=>'portal',   '_method'=>'POST']);
         $builder->connect('/UserServiceApi/getEntitlements',       ['controller'=>'UserServiceApi','action'=>'getEntitlements',       '_method'=>'GET']);
         $builder->connect('/UserServiceApi/getInstituteDetails',   ['controller'=>'UserServiceApi','action'=>'getInstituteDetails',   '_method'=>'GET']);
         $builder->connect('/UserServiceApi/updateInstituteDetails',['controller'=>'UserServiceApi','action'=>'updateInstituteDetails', '_method'=>'POST']);
         $builder->connect('/UserServiceApi/getUsers',['controller'=>'UserServiceApi','action'=>'getUsers', '_method'=>'GET']);
         $builder->connect('/UserServiceApi/updateUserPhoto', ['controller' => 'UserServiceApi', 'action' => 'updateUserPhoto']);
         $builder->get('/UserServiceApi/getStudentUsers', ['controller'=>'UserServiceApi','action'=>'getStudentUsers']);
         $builder->post('/UserServiceApi/toggleStudentUserStatus', ['controller'=>'UserServiceApi','action'=>'toggleStudentUserStatus']);
     //Hostel services
        $builder->connect('/HostelServiceApi/getBuildings', ['controller' => 'HostelServiceApi', 'action' => 'getBuildings', '_method' => 'GET']);
        $builder->connect('/HostelServiceApi/saveBuilding', ['controller' => 'HostelServiceApi', 'action' => 'saveBuilding', '_method' => 'POST']);
        $builder->connect('/HostelServiceApi/deleteBuilding', ['controller' => 'HostelServiceApi', 'action' => 'deleteBuilding', '_method' => 'DELETE'], [
          'pass' => ['buildingId'],
          'buildingId' => '\\d+',
          ]);
 // Rooms
        $builder->connect('/HostelServiceApi/getRooms', ['controller' => 'HostelServiceApi', 'action' => 'getRooms', '_method' => 'GET']);
        $builder->connect('/HostelServiceApi/saveRoom', ['controller' => 'HostelServiceApi', 'action' => 'saveRoom', '_method' => 'POST']);
        $builder->connect('/HostelServiceApi/deleteRoom', ['controller' => 'HostelServiceApi', 'action' => 'deleteRoom', '_method' => 'DELETE'], [
          'pass' => ['buildingId'],
          'buildingId' => '\\d+',
          ]);
      // Seats
        $builder->connect('/HostelServiceApi/getSeats', ['controller' => 'HostelServiceApi', 'action' => 'getSeats', '_method' => 'GET']);
        $builder->connect('/HostelServiceApi/saveSeat', ['controller' => 'HostelServiceApi', 'action' => 'saveSeat', '_method' => 'POST']);
        $builder->connect('/HostelServiceApi/deleteSeat', ['controller' => 'HostelServiceApi', 'action' => 'deleteSeat', '_method' => 'DELETE'], [
          'pass' => ['seatId'],
          'seatId' => '\\d+',
          ]);
// $builder->get('/hostelServiceApi/getHostelEnrollment',   ['controller'=>'HostelServiceApi','action'=>'getHostelEnrollment']);
        $builder->post('/HostelServiceApi/saveHostelEnrollment', ['controller'=>'HostelServiceApi','action'=>'saveHostelEnrollment']);
        $builder->post('/HostelServiceApi/deEnrollHostel',       ['controller'=>'HostelServiceApi','action'=>'deEnrollHostel']);
        $builder->get('/HostelServiceApi/getAvailableSeats',     ['controller'=>'HostelServiceApi','action'=>'getAvailableSeats']);
     
         // ── StaffServiceApi ───────────────────────────────────────────────────
        $builder->connect('/StaffServiceApi/getStaff',                ['controller'=>'StaffServiceApi','action'=>'getStaff',             '_method'=>'GET']);
        $builder->connect('/StaffServiceApi/getHiredStaff',           ['controller'=>'StaffServiceApi','action'=>'getHiredStaff',        '_method'=>'GET']);
        $builder->connect('/StaffServiceApi/getStaffById/:id',        ['controller'=>'StaffServiceApi','action'=>'getStaffById',         '_method'=>'GET'])->setPass(['id']);
        $builder->connect('/StaffServiceApi/getStaffCategories',      ['controller'=>'StaffServiceApi','action'=>'getStaffCategories',   '_method'=>'GET']);
        $builder->connect('/StaffServiceApi/getHiringList',           ['controller'=>'StaffServiceApi','action'=>'getHiringList',        '_method'=>'GET']);
        $builder->connect('/StaffServiceApi/saveStaffRegistration',   ['controller'=>'StaffServiceApi','action'=>'saveStaffRegistration','_method'=>'POST']);
        $builder->connect('/StaffServiceApi/updateHiringDetails/:id', ['controller'=>'StaffServiceApi','action'=>'updateHiringDetails',  '_method'=>'POST'])->setPass(['id']);
        $builder->connect('/StaffServiceApi/updateStaffStatus/:id',   ['controller'=>'StaffServiceApi','action'=>'updateStaffStatus',    '_method'=>'POST'])->setPass(['id']);
        $builder->connect('/StaffServiceApi/deleteStaff/:id',         ['controller'=>'StaffServiceApi','action'=>'deleteStaff',         '_method'=>'DELETE'])->setPass(['id']);
        $builder->connect('/StaffServiceApi/createStaffCategory',     ['controller'=>'StaffServiceApi','action'=>'createStaffCategory',  '_method'=>'POST']);
        $builder->connect('/StaffServiceApi/updateStaffCategory/:id', ['controller'=>'StaffServiceApi','action'=>'updateStaffCategory',  '_method'=>'POST'])->setPass(['id']);
        $builder->connect('/StaffServiceApi/deleteStaffCategory/:id', ['controller'=>'StaffServiceApi','action'=>'deleteStaffCategory',  '_method'=>'DELETE'])->setPass(['id']);
     
     // ── SubjectServiceApi ─────────────────────────────────────────────────
        $builder->connect('/SubjectServiceApi/getSubjects',        ['controller'=>'SubjectServiceApi','action'=>'getSubjects',     '_method'=>'GET']);
        $builder->connect('/SubjectServiceApi/createSubject',      ['controller'=>'SubjectServiceApi','action'=>'createSubject',    '_method'=>'POST']);
        $builder->connect('/SubjectServiceApi/updateSubject/:id',  ['controller'=>'SubjectServiceApi','action'=>'updateSubject',    '_method'=>'POST'])->setPass(['id']);
        $builder->connect('/SubjectServiceApi/deleteSubject/:id',  ['controller'=>'SubjectServiceApi','action'=>'deleteSubject',    '_method'=>'DELETE'])->setPass(['id']);
        $builder->connect('/SubjectServiceApi/createClassSubject',      ['controller'=>'SubjectServiceApi','action'=>'createClassSubject',    '_method'=>'POST']);
        $builder->connect('/SubjectServiceApi/getSubjectTeachers',        ['controller'=>'SubjectServiceApi','action'=>'getSubjectTeachers',     '_method'=>'GET']);
        $builder->connect('/SubjectServiceApi/createSubjectTeacher',      ['controller'=>'SubjectServiceApi','action'=>'createSubjectTeacher',   '_method'=>'POST']);
        $builder->connect('/SubjectServiceApi/updateSubjectTeacher/:id',  ['controller'=>'SubjectServiceApi','action'=>'updateSubjectTeacher',   '_method'=>'POST'])->setPass(['id']);
        $builder->connect('/SubjectServiceApi/deleteSubjectTeacher/:id',  ['controller'=>'SubjectServiceApi','action'=>'deleteSubjectTeacher',   '_method'=>'DELETE'])->setPass(['id']);
        $builder->connect('/SubjectServiceApi/getMaxMarks',               ['controller'=>'SubjectServiceApi','action'=>'getMaxMarks',            '_method'=>'GET']);
        $builder->connect('/SubjectServiceApi/createMaxMarks',            ['controller'=>'SubjectServiceApi','action'=>'createMaxMarks',         '_method'=>'POST']);
        $builder->connect('/SubjectServiceApi/updateMaxMarks/:id',        ['controller'=>'SubjectServiceApi','action'=>'updateMaxMarks',         '_method'=>'POST'])->setPass(['id']);
        $builder->connect('/SubjectServiceApi/deleteMaxMarks/:id',        ['controller'=>'SubjectServiceApi','action'=>'deleteMaxMarks',         '_method'=>'DELETE'])->setPass(['id']);
     // ── ExamServiceApi ────────────────────────────────────────────────────
        $builder->connect('/ExamServiceApi/getExamRankings',         ['controller'=>'ExamServiceApi','action'=>'getExamRankings',  '_method'=>'GET']);
        $builder->connect('/ExamServiceApi/getSchoolInfo',          ['controller'=>'ExamServiceApi','action'=>'getSchoolInfo',           '_method'=>'GET']);
        $builder->connect('/ExamServiceApi/getExams',          ['controller'=>'ExamServiceApi','action'=>'getExams',              '_method'=>'GET']);
        $builder->connect('/ExamServiceApi/createExam',        ['controller'=>'ExamServiceApi','action'=>'createExam',            '_method'=>'POST']);
        $builder->connect('/ExamServiceApi/updateExam/:id',    ['controller'=>'ExamServiceApi','action'=>'updateExam',            '_method'=>'POST'])->setPass(['id']);
        $builder->connect('/ExamServiceApi/deleteExam/:id',    ['controller'=>'ExamServiceApi','action'=>'deleteExam',            '_method'=>'DELETE'])->setPass(['id']);
        $builder->connect('/ExamServiceApi/getClientInfo',            ['controller'=>'ExamServiceApi','action'=>'getClientInfo',           '_method'=>'GET']);
        $builder->connect('/ExamServiceApi/getStudentsForMarksheet',['controller'=>'ExamServiceApi','action'=>'getStudentsForMarksheet', '_method'=>'GET']);
        $builder->connect('/ExamServiceApi/getStudentsForMarks',['controller'=>'ExamServiceApi','action'=>'getStudentsForMarks',   '_method'=>'GET']);
        $builder->connect('/ExamServiceApi/saveMarks',          ['controller'=>'ExamServiceApi','action'=>'saveMarks',            '_method'=>'POST']);
        $builder->connect('/ExamServiceApi/getStudentsWithMarks',['controller'=>'ExamServiceApi','action'=>'getStudentsWithMarks', '_method'=>'GET']);
        $builder->connect('/ExamServiceApi/getMarksheet',        ['controller'=>'ExamServiceApi','action'=>'getMarksheet',         '_method'=>'GET']);
        $builder->get('/ExamServiceApi/getMyMarksheets',         ['controller'=>'ExamServiceApi','action'=>'getMyMarksheets']);
        $builder->get('/ExamServiceApi/getSubjectMaxMarks',      ['controller'=>'ExamServiceApi','action'=>'getSubjectMaxMarks']);
        $builder->get('/ExamServiceApi/getQuickTestMaxMarks',    ['controller'=>'ExamServiceApi','action'=>'getQuickTestMaxMarks']);
        $builder->post('/ExamServiceApi/saveQuickTestMaxMarks',  ['controller'=>'ExamServiceApi','action'=>'saveQuickTestMaxMarks']);
        $builder->post('/ExamServiceApi/promoteStudents',        ['controller'=>'ExamServiceApi','action'=>'promoteStudents']);
        $builder->post('/ExamServiceApi/toggleExamRelease/{id}', ['controller' => 'ExamServiceApi', 'action' => 'toggleExamRelease']);
     //
     ////Transport
     //   $builder->connect('/TransportServiceApi/:action',    ['controller' => 'TransportApi', '_method' => ['GET','POST','PUT','DELETE']]);
     //   $builder->connect('/TransportServiceApi/:action/*',  ['controller' => 'TransportApi', '_method' => ['GET','POST','PUT','DELETE']]);
     //
      // ── Transport API ──────────────────────────────────────────────────────
         $builder->connect('/TransportServiceApi/getRoutes',                  ['controller' => 'TransportServiceApi', 'action' => 'getRoutes',                  '_method' => 'GET']);
         $builder->connect('/TransportServiceApi/createRoute',                ['controller' => 'TransportServiceApi', 'action' => 'createRoute',                '_method' => 'POST']);
         $builder->connect('/TransportServiceApi/updateRoute/:id',            ['controller' => 'TransportServiceApi', 'action' => 'updateRoute',                '_method' => 'PUT'],    ['pass' => ['id']]);
         $builder->connect('/TransportServiceApi/deleteRoute/:id',            ['controller' => 'TransportServiceApi', 'action' => 'deleteRoute',                '_method' => 'DELETE'], ['pass' => ['id']]);
         $builder->connect('/TransportServiceApi/getStops',                   ['controller' => 'TransportServiceApi', 'action' => 'getStops',                   '_method' => 'GET']);
         $builder->connect('/TransportServiceApi/createStop',                 ['controller' => 'TransportServiceApi', 'action' => 'createStop',                 '_method' => 'POST']);
         $builder->connect('/TransportServiceApi/updateStop/:id',             ['controller' => 'TransportServiceApi', 'action' => 'updateStop',                 '_method' => 'PUT'],    ['pass' => ['id']]);
         $builder->connect('/TransportServiceApi/deleteStop/:id',             ['controller' => 'TransportServiceApi', 'action' => 'deleteStop',                 '_method' => 'DELETE'], ['pass' => ['id']]);
         $builder->connect('/TransportServiceApi/getVehicles',                ['controller' => 'TransportServiceApi', 'action' => 'getVehicles',                '_method' => 'GET']);
         $builder->connect('/TransportServiceApi/createVehicle',              ['controller' => 'TransportServiceApi', 'action' => 'createVehicle',              '_method' => 'POST']);
         $builder->connect('/TransportServiceApi/updateVehicle/:id',          ['controller' => 'TransportServiceApi', 'action' => 'updateVehicle',              '_method' => 'PUT'],    ['pass' => ['id']]);
         $builder->connect('/TransportServiceApi/deleteVehicle/:id',          ['controller' => 'TransportServiceApi', 'action' => 'deleteVehicle',              '_method' => 'DELETE'], ['pass' => ['id']]);
         $builder->connect('/TransportServiceApi/getDrivers',                 ['controller' => 'TransportServiceApi', 'action' => 'getDrivers',                 '_method' => 'GET']);
         $builder->connect('/TransportServiceApi/createDriver',               ['controller' => 'TransportServiceApi', 'action' => 'createDriver',               '_method' => 'POST']);
         $builder->connect('/TransportServiceApi/updateDriver/:id',           ['controller' => 'TransportServiceApi', 'action' => 'updateDriver',               '_method' => 'PUT'],    ['pass' => ['id']]);
         $builder->connect('/TransportServiceApi/deleteDriver/:id',           ['controller' => 'TransportServiceApi', 'action' => 'deleteDriver',               '_method' => 'DELETE'], ['pass' => ['id']]);
         $builder->connect('/TransportServiceApi/getAssignments',             ['controller' => 'TransportServiceApi', 'action' => 'getAssignments',             '_method' => 'GET']);
         $builder->connect('/TransportServiceApi/saveAssignment',             ['controller' => 'TransportServiceApi', 'action' => 'saveAssignment',             '_method' => 'POST']);
         $builder->connect('/TransportServiceApi/deleteAssignment/:id',       ['controller' => 'TransportServiceApi', 'action' => 'deleteAssignment',           '_method' => 'DELETE'], ['pass' => ['id']]);
         $builder->connect('/TransportServiceApi/getTransportEnrollments',    ['controller' => 'TransportServiceApi', 'action' => 'getTransportEnrollments',    '_method' => 'GET']);
         $builder->connect('/TransportServiceApi/enrollStudentTransport',     ['controller' => 'TransportServiceApi', 'action' => 'enrollStudentTransport',     '_method' => 'POST']);
         $builder->connect('/TransportServiceApi/updateTransportEnrollment/:id', ['controller' => 'TransportServiceApi', 'action' => 'updateTransportEnrollment', '_method' => 'PUT'],  ['pass' => ['id']]);
         $builder->connect('/TransportServiceApi/removeTransportEnrollment/:id', ['controller' => 'TransportServiceApi', 'action' => 'removeTransportEnrollment', '_method' => 'DELETE'], ['pass' => ['id']]);
         $builder->connect('/TransportServiceApi/getTransportSummary',        ['controller' => 'TransportServiceApi', 'action' => 'getTransportSummary',        '_method' => 'GET']);
         $builder->connect('/TransportServiceApi/getStudentTransportEnrollment', ['controller' => 'TransportServiceApi', 'action' => 'getStudentTransportEnrollment', '_method' => 'GET']);
     /*
         * ...and connect the rest of 'Pages' controller's URLs.
         */
        $builder->connect('/pages/*', 'Pages::display');

        // ══════════════════════════════════════════════════════════════════════
        // Clean URL aliases — hides internal controller names from the browser.
        // ALL web-facing controllers are mapped here.  API controllers keep
        // their original paths (they are consumed by JS/mobile, not browsers).
        // CakePHP reverse-router uses the FIRST matching route, so helpers like
        // $this->Html->link(['controller'=>'SsmsClients','action'=>'index'])
        // will automatically generate /admin/clients — no template changes needed.
        // ══════════════════════════════════════════════════════════════════════
       $builder->connect('/SchoolSettingsServiceApi/getSettings',  ['controller'=>'SchoolSettingsServiceApi','action'=>'getSettings']);
       $builder->connect('/SchoolSettingsServiceApi/saveSettings', ['controller'=>'SchoolSettingsServiceApi','action'=>'saveSettings']);
        // ── Auth ──────────────────────────────────────────────────────────────
        $builder->connect('/login',   ['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
        $builder->connect('/logout',  ['controller' => 'SaweraSsmsUsers', 'action' => 'logout']);
        $builder->connect('/users',                  ['controller' => 'SaweraSsmsUsers', 'action' => 'index']);
        $builder->connect('/users/{action}',         ['controller' => 'SaweraSsmsUsers']);
        $builder->connect('/users/{action}/*',       ['controller' => 'SaweraSsmsUsers']);

        // ── Dashboard ─────────────────────────────────────────────────────────
        $builder->connect('/dashboard',       ['controller' => 'Dashboards', 'action' => 'dashboard']);
        $builder->connect('/admin/dashboard',            ['controller' => 'Dashboards', 'action' => 'superuserDashboard']);
        $builder->connect('/admin/toggle-user-status',          ['controller' => 'Dashboards',       'action' => 'toggleUserStatus']);
        $builder->connect('/admin/send-marketing-email',        ['controller' => 'Dashboards',       'action' => 'sendMarketingEmail']);

        // ── Support Tickets ───────────────────────────────────────────────────
        $builder->connect('/contact-support',                    ['controller' => 'SupportTickets',   'action' => 'submit']);
        $builder->connect('/my-tickets',                         ['controller' => 'SupportTickets',   'action' => 'myTickets']);
        $builder->connect('/my-ticket/*',                        ['controller' => 'SupportTickets',   'action' => 'ticketDetail']);
        $builder->connect('/admin/support-tickets',              ['controller' => 'SupportTickets',   'action' => 'index']);
        $builder->connect('/admin/support-tickets/view/*',   ['controller' => 'SupportTickets', 'action' => 'view']);
        $builder->connect('/admin/support-tickets/delete/*', ['controller' => 'SupportTickets', 'action' => 'delete']);
        // keep old superuserDashboard URL working (used in redirects / sidebar links)
        $builder->connect('/Dashboards/superuserDashboard', ['controller' => 'Dashboards', 'action' => 'superuserDashboard']);

        // ── Superuser — Client Management ─────────────────────────────────────
        $builder->connect('/admin/clients',                    ['controller' => 'SsmsClients', 'action' => 'index']);
        $builder->connect('/admin/clients/modules/*',          ['controller' => 'SsmsClients', 'action' => 'manageModules']);
        $builder->connect('/admin/clients/{action}',           ['controller' => 'SsmsClients']);
        $builder->connect('/admin/clients/{action}/*',         ['controller' => 'SsmsClients']);
        // public registration page
        $builder->connect('/register', ['controller' => 'SsmsClients', 'action' => 'clientRegistration']);
        $builder->connect('/privacy-policy', ['controller' => 'SsmsClients', 'action' => 'privacyPolicy']);

        // ── Students ──────────────────────────────────────────────────────────
        $builder->connect('/students',                   ['controller' => 'SsmsStudentRegistration', 'action' => 'index']);
        $builder->connect('/students/stud-reg',          ['controller' => 'SsmsStudentRegistration', 'action' => 'studReg']);
        $builder->connect('/students/import-students',   ['controller' => 'SsmsStudentRegistration', 'action' => 'importStudents']);
        $builder->connect('/students/import-template',   ['controller' => 'SsmsStudentRegistration', 'action' => 'importTemplate']);
        $builder->connect('/students/{action}',          ['controller' => 'SsmsStudentRegistration']);
        $builder->connect('/students/{action}/*',        ['controller' => 'SsmsStudentRegistration']);

        // ── Enrollment ────────────────────────────────────────────────────────
        $builder->connect('/enrollment',          ['controller' => 'SsmsStudentEnrollment', 'action' => 'index']);
        $builder->connect('/enrollment/{action}', ['controller' => 'SsmsStudentEnrollment']);
        $builder->connect('/enrollment/{action}/*', ['controller' => 'SsmsStudentEnrollment']);

        // ── Attendance ────────────────────────────────────────────────────────
        $builder->connect('/attendance',          ['controller' => 'StudentAttendance', 'action' => 'index']);
        $builder->connect('/attendance/{action}', ['controller' => 'StudentAttendance']);
        $builder->connect('/attendance/{action}/*', ['controller' => 'StudentAttendance']);

        // ── Staff ─────────────────────────────────────────────────────────────
        $builder->connect('/staff',                      ['controller' => 'SsmsStaff', 'action' => 'index']);
        $builder->connect('/staff/{action}',             ['controller' => 'SsmsStaff']);
        $builder->connect('/staff/{action}/*',           ['controller' => 'SsmsStaff']);
        $builder->connect('/staff-categories',           ['controller' => 'StaffCategory', 'action' => 'index']);
        $builder->connect('/staff-categories/{action}',  ['controller' => 'StaffCategory']);
        $builder->connect('/staff-categories/{action}/*',['controller' => 'StaffCategory']);

        // ── Setup: Branches / Classes / Sections / Sessions ───────────────────
        $builder->connect('/setup/branches',            ['controller' => 'SsmsBranch',    'action' => 'index']);
        $builder->connect('/setup/branches/{action}',   ['controller' => 'SsmsBranch']);
        $builder->connect('/setup/branches/{action}/*', ['controller' => 'SsmsBranch']);

        $builder->connect('/setup/classes',             ['controller' => 'SsmsClasses',   'action' => 'index']);
        $builder->connect('/setup/classes/{action}',    ['controller' => 'SsmsClasses']);
        $builder->connect('/setup/classes/{action}/*',  ['controller' => 'SsmsClasses']);

        $builder->connect('/setup/sections',            ['controller' => 'SsmsSections',  'action' => 'index']);
        $builder->connect('/setup/sections/{action}',   ['controller' => 'SsmsSections']);
        $builder->connect('/setup/sections/{action}/*', ['controller' => 'SsmsSections']);

        $builder->connect('/setup/sessions',            ['controller' => 'SsmsSessions',  'action' => 'index']);
        $builder->connect('/setup/sessions/{action}',   ['controller' => 'SsmsSessions']);
        $builder->connect('/setup/sessions/{action}/*', ['controller' => 'SsmsSessions']);

        // ── Subjects & Timetable ──────────────────────────────────────────────
        $builder->connect('/subjects',               ['controller' => 'SsmsSubjects',      'action' => 'index']);
        $builder->connect('/subjects/{action}',      ['controller' => 'SsmsSubjects']);
        $builder->connect('/subjects/{action}/*',    ['controller' => 'SsmsSubjects']);

        $builder->connect('/class-subjects',              ['controller' => 'SsmsClassSubjects', 'action' => 'index']);
        $builder->connect('/class-subjects/{action}',     ['controller' => 'SsmsClassSubjects']);
        $builder->connect('/class-subjects/{action}/*',   ['controller' => 'SsmsClassSubjects']);

        $builder->connect('/subject-teachers',            ['controller' => 'SsmsSubjectTeacher', 'action' => 'index']);
        $builder->connect('/subject-teachers/{action}',   ['controller' => 'SsmsSubjectTeacher']);
        $builder->connect('/subject-teachers/{action}/*', ['controller' => 'SsmsSubjectTeacher']);

        $builder->connect('/periods',            ['controller' => 'SsmsPeriods',   'action' => 'index']);
        $builder->connect('/periods/{action}',   ['controller' => 'SsmsPeriods']);
        $builder->connect('/periods/{action}/*', ['controller' => 'SsmsPeriods']);

        $builder->connect('/timetable',            ['controller' => 'SsmsTimetable', 'action' => 'manage']);
        $builder->connect('/timetable/{action}',   ['controller' => 'SsmsTimetable']);
        $builder->connect('/timetable/{action}/*', ['controller' => 'SsmsTimetable']);

        // ── Exams & Marks ─────────────────────────────────────────────────────
        $builder->connect('/exams',            ['controller' => 'SsmsExams', 'action' => 'index']);
        $builder->connect('/exams/{action}',   ['controller' => 'SsmsExams']);
        $builder->connect('/exams/{action}/*', ['controller' => 'SsmsExams']);

        $builder->connect('/marks',            ['controller' => 'SsmsMarks', 'action' => 'index']);
        $builder->connect('/marks/{action}',   ['controller' => 'SsmsMarks']);
        $builder->connect('/marks/{action}/*', ['controller' => 'SsmsMarks']);

        $builder->connect('/max-marks',            ['controller' => 'SsmsMaxMarks', 'action' => 'index']);
        $builder->connect('/max-marks/{action}',   ['controller' => 'SsmsMaxMarks']);
        $builder->connect('/max-marks/{action}/*', ['controller' => 'SsmsMaxMarks']);

        // ── Fees ──────────────────────────────────────────────────────────────
        $builder->connect('/fees/items',               ['controller' => 'SsmsFeeItems',       'action' => 'index']);
        $builder->connect('/fees/items/{action}',      ['controller' => 'SsmsFeeItems']);
        $builder->connect('/fees/items/{action}/*',    ['controller' => 'SsmsFeeItems']);

        $builder->connect('/fees/structure',           ['controller' => 'SsmsFeeStructure',   'action' => 'index']);
        $builder->connect('/fees/structure/{action}',  ['controller' => 'SsmsFeeStructure']);
        $builder->connect('/fees/structure/{action}/*',['controller' => 'SsmsFeeStructure']);

        $builder->connect('/fees/paid',                ['controller' => 'SsmsFeePaidDetails', 'action' => 'index']);
        $builder->connect('/fees/paid/{action}',       ['controller' => 'SsmsFeePaidDetails']);
        $builder->connect('/fees/paid/{action}/*',     ['controller' => 'SsmsFeePaidDetails']);

        $builder->connect('/fees/receipts',            ['controller' => 'SsmsFeepaidReceipt', 'action' => 'index']);
        $builder->connect('/fees/receipts/{action}',   ['controller' => 'SsmsFeepaidReceipt']);
        $builder->connect('/fees/receipts/{action}/*', ['controller' => 'SsmsFeepaidReceipt']);

        $builder->connect('/fees/discounts',            ['controller' => 'SsmsStudentDiscounts', 'action' => 'index']);
        $builder->connect('/fees/discounts/{action}',   ['controller' => 'SsmsStudentDiscounts']);
        $builder->connect('/fees/discounts/{action}/*', ['controller' => 'SsmsStudentDiscounts']);

        $builder->connect('/reports/balancesheet',           ['controller' => 'SsmsBalancesheet', 'action' => 'index']);
        $builder->connect('/reports/balancesheet/{action}',  ['controller' => 'SsmsBalancesheet']);
        $builder->connect('/reports/balancesheet/{action}/*',['controller' => 'SsmsBalancesheet']);

        // ── Hostel ────────────────────────────────────────────────────────────
        $builder->connect('/hostel/buildings',            ['controller' => 'SsmsBuilding',          'action' => 'index']);
        $builder->connect('/hostel/buildings/{action}',   ['controller' => 'SsmsBuilding']);
        $builder->connect('/hostel/buildings/{action}/*', ['controller' => 'SsmsBuilding']);

        $builder->connect('/hostel/rooms',                ['controller' => 'SsmsRooms',             'action' => 'index']);
        $builder->connect('/hostel/rooms/{action}',       ['controller' => 'SsmsRooms']);
        $builder->connect('/hostel/rooms/{action}/*',     ['controller' => 'SsmsRooms']);

        $builder->connect('/hostel/seats',                ['controller' => 'SsmsRoomSeats',         'action' => 'index']);
        $builder->connect('/hostel/seats/{action}',       ['controller' => 'SsmsRoomSeats']);
        $builder->connect('/hostel/seats/{action}/*',     ['controller' => 'SsmsRoomSeats']);

        $builder->connect('/hostel/enrollment',           ['controller' => 'SsmsHostelEnrollment',  'action' => 'index']);
        $builder->connect('/hostel/enrollment/{action}',  ['controller' => 'SsmsHostelEnrollment']);
        $builder->connect('/hostel/enrollment/{action}/*',['controller' => 'SsmsHostelEnrollment']);

        // ── Transport ─────────────────────────────────────────────────────────
        $builder->connect('/transport/routes',              ['controller' => 'SsmsTransportRoutes',      'action' => 'index']);
        $builder->connect('/transport/routes/{action}',     ['controller' => 'SsmsTransportRoutes']);
        $builder->connect('/transport/routes/{action}/*',   ['controller' => 'SsmsTransportRoutes']);

        $builder->connect('/transport/stops',               ['controller' => 'SsmsTransportStops',       'action' => 'index']);
        $builder->connect('/transport/stops/{action}',      ['controller' => 'SsmsTransportStops']);
        $builder->connect('/transport/stops/{action}/*',    ['controller' => 'SsmsTransportStops']);

        $builder->connect('/transport/vehicles',            ['controller' => 'SsmsTransportVehicles',    'action' => 'index']);
        $builder->connect('/transport/vehicles/{action}',   ['controller' => 'SsmsTransportVehicles']);
        $builder->connect('/transport/vehicles/{action}/*', ['controller' => 'SsmsTransportVehicles']);

        $builder->connect('/transport/drivers',             ['controller' => 'SsmsTransportDrivers',     'action' => 'index']);
        $builder->connect('/transport/drivers/{action}',    ['controller' => 'SsmsTransportDrivers']);
        $builder->connect('/transport/drivers/{action}/*',  ['controller' => 'SsmsTransportDrivers']);

        $builder->connect('/transport/assignments',             ['controller' => 'SsmsTransportAssignments',  'action' => 'index']);
        $builder->connect('/transport/assignments/{action}',    ['controller' => 'SsmsTransportAssignments']);
        $builder->connect('/transport/assignments/{action}/*',  ['controller' => 'SsmsTransportAssignments']);

        $builder->connect('/transport/enrollment',              ['controller' => 'SsmsTransportEnrollments', 'action' => 'index']);
        $builder->connect('/transport/enrollment/{action}',     ['controller' => 'SsmsTransportEnrollments']);
        $builder->connect('/transport/enrollment/{action}/*',   ['controller' => 'SsmsTransportEnrollments']);

        // ── Enquiry / Events ──────────────────────────────────────────────────
        $builder->connect('/enquiry',            ['controller' => 'SsmsEnquiry',      'action' => 'index']);
        $builder->connect('/enquiry/{action}',   ['controller' => 'SsmsEnquiry']);
        $builder->connect('/enquiry/{action}/*', ['controller' => 'SsmsEnquiry']);

        $builder->connect('/events',             ['controller' => 'SsmsSchoolEvents', 'action' => 'index']);
        $builder->connect('/events/{action}',    ['controller' => 'SsmsSchoolEvents']);
        $builder->connect('/events/{action}/*',  ['controller' => 'SsmsSchoolEvents']);

        $builder->get('/SchoolEventsApi/getUpcomingEvents', ['controller'=>'SchoolEventsApi','action'=>'getUpcomingEvents']);
        $builder->post('/SchoolEventsApi/createEvent',      ['controller'=>'SchoolEventsApi','action'=>'createEvent']);
        $builder->post('/SchoolEventsApi/updateEvent/:id',  ['controller'=>'SchoolEventsApi','action'=>'updateEvent'])->setPass(['id']);
        $builder->delete('/SchoolEventsApi/deleteEvent/:id',['controller'=>'SchoolEventsApi','action'=>'deleteEvent'])->setPass(['id']);
        $builder->post('/SchoolEventsApi/deleteEvent/:id',  ['controller'=>'SchoolEventsApi','action'=>'deleteEvent'])->setPass(['id']);

        // ── Finance Module ────────────────────────────────────────────────────
        $builder->connect('/finance',                          ['controller' => 'Dashboards',          'action' => 'financeDashboard']);
        $builder->connect('/finance/income',                   ['controller' => 'FinIncome',            'action' => 'index']);
        $builder->connect('/finance/income/{action}',          ['controller' => 'FinIncome']);
        $builder->connect('/finance/income/{action}/*',        ['controller' => 'FinIncome']);

        $builder->connect('/finance/expenses',                 ['controller' => 'FinExpenses',          'action' => 'index']);
        $builder->connect('/finance/expenses/{action}',        ['controller' => 'FinExpenses']);
        $builder->connect('/finance/expenses/{action}/*',      ['controller' => 'FinExpenses']);

        $builder->connect('/finance/accounts',                 ['controller' => 'FinChartOfAccounts',   'action' => 'index']);
        $builder->connect('/finance/accounts/{action}',        ['controller' => 'FinChartOfAccounts']);
        $builder->connect('/finance/accounts/{action}/*',      ['controller' => 'FinChartOfAccounts']);

        $builder->connect('/finance/bank-accounts',            ['controller' => 'FinBankAccounts',      'action' => 'index']);
        $builder->connect('/finance/bank-accounts/{action}',   ['controller' => 'FinBankAccounts']);
        $builder->connect('/finance/bank-accounts/{action}/*', ['controller' => 'FinBankAccounts']);

        $builder->connect('/finance/fiscal-years',             ['controller' => 'FinFiscalYears',       'action' => 'index']);
        $builder->connect('/finance/fiscal-years/{action}',    ['controller' => 'FinFiscalYears']);
        $builder->connect('/finance/fiscal-years/{action}/*',  ['controller' => 'FinFiscalYears']);

        // Finance Reports
        $builder->connect('/finance/reports/daybook',       ['controller'=>'FinReports','action'=>'daybook']);
        $builder->connect('/finance/reports/ledger',        ['controller'=>'FinReports','action'=>'ledger']);
        $builder->connect('/finance/reports/profit-loss',   ['controller'=>'FinReports','action'=>'profitLoss']);
        $builder->connect('/finance/reports/balance-sheet', ['controller'=>'FinReports','action'=>'balanceSheet']);
        $builder->connect('/finance/reports/trial-balance', ['controller'=>'FinReports','action'=>'trialBalance']);
        $builder->connect('/finance/reports/cash-flow',     ['controller'=>'FinReports','action'=>'cashFlow']);
        $builder->connect('/finance/reports/tally-export',  ['controller'=>'FinReports','action'=>'tallyExport']);
        $builder->connect('/finance/superview',             ['controller'=>'FinSuperview','action'=>'index']);

        // Finance Vendors
        $builder->connect('/finance/vendors',                    ['controller'=>'FinVendors','action'=>'index']);
        $builder->connect('/finance/vendors/add',                ['controller'=>'FinVendors','action'=>'add']);
        $builder->connect('/finance/vendors/edit/*',             ['controller'=>'FinVendors','action'=>'edit'])->setPass(['0']);
        $builder->connect('/finance/vendors/view/*',             ['controller'=>'FinVendors','action'=>'view'])->setPass(['0']);

        // Finance Purchase Orders
        $builder->connect('/finance/purchase-orders',            ['controller'=>'FinPurchaseOrders','action'=>'index']);
        $builder->connect('/finance/purchase-orders/add',        ['controller'=>'FinPurchaseOrders','action'=>'add']);
        $builder->connect('/finance/purchase-orders/view/*',     ['controller'=>'FinPurchaseOrders','action'=>'view'])->setPass(['0']);
        $builder->connect('/finance/purchase-orders/approve/*',  ['controller'=>'FinPurchaseOrders','action'=>'approve'])->setPass(['0']);
        $builder->connect('/finance/purchase-orders/add-grn/*',  ['controller'=>'FinPurchaseOrders','action'=>'addGrn'])->setPass(['0']);
        $builder->connect('/finance/purchase-orders/add-invoice/*',  ['controller'=>'FinPurchaseOrders','action'=>'addInvoice'])->setPass(['0']);
        $builder->connect('/finance/purchase-orders/pay-invoice/*',  ['controller'=>'FinPurchaseOrders','action'=>'payInvoice'])->setPass(['0']);

        // Finance Payroll
        $builder->connect('/finance/payroll',                          ['controller'=>'FinPayroll','action'=>'index']);
        $builder->connect('/finance/payroll/salary-structures',        ['controller'=>'FinPayroll','action'=>'salaryStructures']);
        $builder->connect('/finance/payroll/add-salary-structure',     ['controller'=>'FinPayroll','action'=>'addSalaryStructure']);
        $builder->connect('/finance/payroll/edit-salary-structure/*',  ['controller'=>'FinPayroll','action'=>'editSalaryStructure'])->setPass(['0']);
        $builder->connect('/finance/payroll/advances',                 ['controller'=>'FinPayroll','action'=>'advances']);
        $builder->connect('/finance/payroll/add-advance',              ['controller'=>'FinPayroll','action'=>'addAdvance']);
        $builder->connect('/finance/payroll/process',                  ['controller'=>'FinPayroll','action'=>'processPayroll']);
        $builder->connect('/finance/payroll/view/*',                   ['controller'=>'FinPayroll','action'=>'view'])->setPass(['0']);
        $builder->connect('/finance/payroll/approve/*',                ['controller'=>'FinPayroll','action'=>'approve'])->setPass(['0']);
        $builder->connect('/finance/payroll/salary-slip/*',            ['controller'=>'FinPayroll','action'=>'salarySlip'])->setPass(['0']);

        // Finance Budgets
        $builder->connect('/finance/budgets',                     ['controller'=>'FinBudgets','action'=>'index']);
        $builder->connect('/finance/budgets/dashboard',           ['controller'=>'FinBudgets','action'=>'dashboard']);
        $builder->connect('/finance/budgets/{action}',            ['controller'=>'FinBudgets']);
        $builder->connect('/finance/budgets/{action}/*',          ['controller'=>'FinBudgets']);
        $builder->connect('/finance/api/check-budget',            ['controller'=>'FinBudgets','action'=>'checkBudget']);

        // Finance API (JSON)
        $builder->connect('/finance/api/{action}',             ['controller' => 'FinanceApi']);
        $builder->connect('/finance/api/{action}/*',           ['controller' => 'FinanceApi']);

        // ── Library Module ────────────────────────────────────────────────────
        // Catalogue
        $builder->connect('/library',                          ['controller' => 'LibBooks',         'action' => 'index']);
        $builder->connect('/library/books',                    ['controller' => 'LibBooks',         'action' => 'index']);
        $builder->connect('/library/books/add',                ['controller' => 'LibBooks',         'action' => 'add']);
        $builder->connect('/library/books/edit/*',             ['controller' => 'LibBooks',         'action' => 'edit'])->setPass(['0']);
        $builder->connect('/library/books/view/*',             ['controller' => 'LibBooks',         'action' => 'view'])->setPass(['0']);
        $builder->connect('/library/books/copies/*',           ['controller' => 'LibBooks',         'action' => 'copies'])->setPass(['0']);
        $builder->connect('/library/books/delete/*',           ['controller' => 'LibBooks',         'action' => 'delete'])->setPass(['0']);
        $builder->connect('/library/categories',               ['controller' => 'LibBooks',         'action' => 'categories']);
        $builder->connect('/library/authors',                  ['controller' => 'LibBooks',         'action' => 'authors']);
        $builder->connect('/library/publishers',               ['controller' => 'LibBooks',         'action' => 'publishers']);

        // Circulation
        $builder->connect('/library/circulation',              ['controller' => 'LibCirculation',   'action' => 'index']);
        $builder->connect('/library/checkout',                 ['controller' => 'LibCirculation',   'action' => 'checkout']);
        $builder->connect('/library/return',                   ['controller' => 'LibCirculation',   'action' => 'return']);
        $builder->connect('/library/renew',                    ['controller' => 'LibCirculation',   'action' => 'renew']);
        $builder->connect('/library/overdue',                  ['controller' => 'LibCirculation',   'action' => 'overdue']);
        $builder->connect('/library/history/*',                ['controller' => 'LibCirculation',   'action' => 'history'])->setPass(['0']);

        // Members
        $builder->connect('/library/members',                  ['controller' => 'LibMembers',       'action' => 'index']);
        $builder->connect('/library/members/add',              ['controller' => 'LibMembers',       'action' => 'add']);
        $builder->connect('/library/members/edit/*',           ['controller' => 'LibMembers',       'action' => 'edit'])->setPass(['0']);
        $builder->connect('/library/members/profile/*',        ['controller' => 'LibMembers',       'action' => 'profile'])->setPass(['0']);
        $builder->connect('/library/members/bulk-enroll',      ['controller' => 'LibMembers',       'action' => 'bulkEnroll']);

        // Fines
        $builder->connect('/library/fines',                    ['controller' => 'LibFines',         'action' => 'index']);
        $builder->connect('/library/fines/collect/*',          ['controller' => 'LibFines',         'action' => 'collect'])->setPass(['0']);
        $builder->connect('/library/fines/waive/*',            ['controller' => 'LibFines',         'action' => 'waive'])->setPass(['0']);

        // Reservations
        $builder->connect('/library/reservations',             ['controller' => 'LibReservations',  'action' => 'index']);
        $builder->connect('/library/reservations/place',       ['controller' => 'LibReservations',  'action' => 'place']);
        $builder->connect('/library/reservations/cancel/*',    ['controller' => 'LibReservations',  'action' => 'cancel'])->setPass(['0']);

        // Computers & Desk Booking
        $builder->connect('/library/computers',                ['controller' => 'LibComputers',     'action' => 'index']);
        $builder->connect('/library/computers/add',            ['controller' => 'LibComputers',     'action' => 'add']);
        $builder->connect('/library/computers/edit/*',         ['controller' => 'LibComputers',     'action' => 'edit'])->setPass(['0']);
        $builder->connect('/library/computers/availability',   ['controller' => 'LibComputers',     'action' => 'availability']);
        $builder->connect('/library/computers/book',           ['controller' => 'LibComputers',     'action' => 'book']);
        $builder->connect('/library/computers/bookings',       ['controller' => 'LibComputers',     'action' => 'bookings']);
        $builder->connect('/library/computers/checkin/*',      ['controller' => 'LibComputers',     'action' => 'checkin'])->setPass(['0']);
        $builder->connect('/library/computers/checkout/*',     ['controller' => 'LibComputers',     'action' => 'checkout'])->setPass(['0']);

// ══════════════════════════════════════════════════════════════════════════════
// CATALOGUE  →  LibraryCatalogApiController
// ══════════════════════════════════════════════════════════════════════════════

// ⭐ Universal barcode / code resolver — copy barcode, accession no,
//    member card, membership no, or book ISBN. One call per scan.
$builder->get('/libraryCatalogApi/lookup', ['controller' => 'LibraryCatalogApi', 'action' => 'lookup']);

// ── Books ────────────────────────────────────────────────────────────────────
$builder->get(   '/libraryCatalogApi/books',           ['controller' => 'LibraryCatalogApi', 'action' => 'books']);
$builder->get(   '/libraryCatalogApi/book/{id}',       ['controller' => 'LibraryCatalogApi', 'action' => 'book'])->setPass(['id']);
$builder->post(  '/libraryCatalogApi/saveBook',        ['controller' => 'LibraryCatalogApi', 'action' => 'saveBook']);
$builder->put(   '/libraryCatalogApi/saveBook',        ['controller' => 'LibraryCatalogApi', 'action' => 'saveBook']);
$builder->delete('/libraryCatalogApi/deleteBook/{id}', ['controller' => 'LibraryCatalogApi', 'action' => 'deleteBook'])->setPass(['id']);

// ── Copies (accession records) ───────────────────────────────────────────────
$builder->get(   '/libraryCatalogApi/copies',           ['controller' => 'LibraryCatalogApi', 'action' => 'copies']);
$builder->get(   '/libraryCatalogApi/copy/{id}',        ['controller' => 'LibraryCatalogApi', 'action' => 'copy'])->setPass(['id']);
$builder->post(  '/libraryCatalogApi/saveCopy',         ['controller' => 'LibraryCatalogApi', 'action' => 'saveCopy']);
$builder->put(   '/libraryCatalogApi/saveCopy',         ['controller' => 'LibraryCatalogApi', 'action' => 'saveCopy']);
$builder->post(  '/libraryCatalogApi/generateCopies',   ['controller' => 'LibraryCatalogApi', 'action' => 'generateCopies']);
$builder->post(  '/libraryCatalogApi/withdrawCopy',     ['controller' => 'LibraryCatalogApi', 'action' => 'withdrawCopy']);
$builder->delete('/libraryCatalogApi/deleteCopy/{id}',  ['controller' => 'LibraryCatalogApi', 'action' => 'deleteCopy'])->setPass(['id']);
$builder->get(   '/libraryCatalogApi/nextAccession',    ['controller' => 'LibraryCatalogApi', 'action' => 'nextAccession']);

// ── Categories ───────────────────────────────────────────────────────────────
$builder->get(   '/libraryCatalogApi/categories',           ['controller' => 'LibraryCatalogApi', 'action' => 'categories']);
$builder->post(  '/libraryCatalogApi/saveCategory',         ['controller' => 'LibraryCatalogApi', 'action' => 'saveCategory']);
$builder->put(   '/libraryCatalogApi/saveCategory',         ['controller' => 'LibraryCatalogApi', 'action' => 'saveCategory']);
$builder->delete('/libraryCatalogApi/deleteCategory/{id}',  ['controller' => 'LibraryCatalogApi', 'action' => 'deleteCategory'])->setPass(['id']);

// ── Authors ──────────────────────────────────────────────────────────────────
$builder->get(   '/libraryCatalogApi/authors',           ['controller' => 'LibraryCatalogApi', 'action' => 'authors']);
$builder->post(  '/libraryCatalogApi/saveAuthor',        ['controller' => 'LibraryCatalogApi', 'action' => 'saveAuthor']);
$builder->put(   '/libraryCatalogApi/saveAuthor',        ['controller' => 'LibraryCatalogApi', 'action' => 'saveAuthor']);
$builder->delete('/libraryCatalogApi/deleteAuthor/{id}', ['controller' => 'LibraryCatalogApi', 'action' => 'deleteAuthor'])->setPass(['id']);
$builder->post(  '/libraryCatalogApi/mergeAuthors',      ['controller' => 'LibraryCatalogApi', 'action' => 'mergeAuthors']);

// ── Publishers ───────────────────────────────────────────────────────────────
$builder->get(   '/libraryCatalogApi/publishers',           ['controller' => 'LibraryCatalogApi', 'action' => 'publishers']);
$builder->post(  '/libraryCatalogApi/savePublisher',        ['controller' => 'LibraryCatalogApi', 'action' => 'savePublisher']);
$builder->put(   '/libraryCatalogApi/savePublisher',        ['controller' => 'LibraryCatalogApi', 'action' => 'savePublisher']);
$builder->delete('/libraryCatalogApi/deletePublisher/{id}', ['controller' => 'LibraryCatalogApi', 'action' => 'deletePublisher'])->setPass(['id']);

// ── Shared dropdown payload ──────────────────────────────────────────────────
$builder->get('/libraryCatalogApi/filters', ['controller' => 'LibraryCatalogApi', 'action' => 'filters']);


// ══════════════════════════════════════════════════════════════════════════════
// MEMBERS  →  LibraryMemberApiController
// ══════════════════════════════════════════════════════════════════════════════

$builder->get(   '/libraryMemberApi/members',             ['controller' => 'LibraryMemberApi', 'action' => 'members']);
$builder->get(   '/libraryMemberApi/member/{id}',         ['controller' => 'LibraryMemberApi', 'action' => 'member'])->setPass(['id']);
$builder->post(  '/libraryMemberApi/saveMember',          ['controller' => 'LibraryMemberApi', 'action' => 'saveMember']);
$builder->put(   '/libraryMemberApi/saveMember',          ['controller' => 'LibraryMemberApi', 'action' => 'saveMember']);
$builder->post(  '/libraryMemberApi/setStatus',           ['controller' => 'LibraryMemberApi', 'action' => 'setStatus']);
$builder->delete('/libraryMemberApi/deleteMember/{id}',   ['controller' => 'LibraryMemberApi', 'action' => 'deleteMember'])->setPass(['id']);

// Membership numbers + printable card
$builder->get('/libraryMemberApi/nextMembershipNo', ['controller' => 'LibraryMemberApi', 'action' => 'nextMembershipNo']);
$builder->get('/libraryMemberApi/card/{id}',        ['controller' => 'LibraryMemberApi', 'action' => 'card'])->setPass(['id']);

// Bulk enrolment from existing student / staff records
$builder->get( '/libraryMemberApi/enrolCandidates', ['controller' => 'LibraryMemberApi', 'action' => 'enrolCandidates']);
$builder->post('/libraryMemberApi/bulkEnrol',       ['controller' => 'LibraryMemberApi', 'action' => 'bulkEnrol']);

// Shared dropdown payload
$builder->get('/libraryMemberApi/filters', ['controller' => 'LibraryMemberApi', 'action' => 'filters']);


// ══════════════════════════════════════════════════════════════════════════════
// CIRCULATION  →  LibraryCirculationApiController
// ══════════════════════════════════════════════════════════════════════════════

// ── Loans ────────────────────────────────────────────────────────────────────
$builder->get('/libraryCirculationApi/checkouts',     ['controller' => 'LibraryCirculationApi', 'action' => 'checkouts']);
$builder->get('/libraryCirculationApi/checkout/{id}', ['controller' => 'LibraryCirculationApi', 'action' => 'checkout'])->setPass(['id']);

// ── The three desk actions ───────────────────────────────────────────────────
// NOTE: the /return path maps to the returnBook action — "return" is a PHP
// reserved word and cannot be used as a method name.
$builder->post('/libraryCirculationApi/issue',    ['controller' => 'LibraryCirculationApi', 'action' => 'issue']);
$builder->post('/libraryCirculationApi/return',   ['controller' => 'LibraryCirculationApi', 'action' => 'returnBook']);
$builder->post('/libraryCirculationApi/renew',    ['controller' => 'LibraryCirculationApi', 'action' => 'renew']);
$builder->post('/libraryCirculationApi/markLost', ['controller' => 'LibraryCirculationApi', 'action' => 'markLost']);

// ── Overdue ──────────────────────────────────────────────────────────────────
$builder->get( '/libraryCirculationApi/overdue',       ['controller' => 'LibraryCirculationApi', 'action' => 'overdue']);
$builder->post('/libraryCirculationApi/sendReminders', ['controller' => 'LibraryCirculationApi', 'action' => 'sendReminders']);

// ── Holds ────────────────────────────────────────────────────────────────────
$builder->get( '/libraryCirculationApi/reservations',       ['controller' => 'LibraryCirculationApi', 'action' => 'reservations']);
$builder->post('/libraryCirculationApi/reserve',            ['controller' => 'LibraryCirculationApi', 'action' => 'reserve']);
$builder->post('/libraryCirculationApi/cancelReservation',  ['controller' => 'LibraryCirculationApi', 'action' => 'cancelReservation']);

// ── Maintenance sweeps (call from cron, not from the app) ────────────────────
$builder->post('/libraryCirculationApi/expireHolds',  ['controller' => 'LibraryCirculationApi', 'action' => 'expireHolds']);
$builder->post('/libraryCirculationApi/sweepOverdue', ['controller' => 'LibraryCirculationApi', 'action' => 'sweepOverdue']);


// ══════════════════════════════════════════════════════════════════════════════
// FINES  →  LibraryFineApiController
// ══════════════════════════════════════════════════════════════════════════════

$builder->get('/libraryFineApi/fines',     ['controller' => 'LibraryFineApi', 'action' => 'fines']);
$builder->get('/libraryFineApi/fine/{id}', ['controller' => 'LibraryFineApi', 'action' => 'fine'])->setPass(['id']);

// Money
$builder->post('/libraryFineApi/collectPayment', ['controller' => 'LibraryFineApi', 'action' => 'collectPayment']);
$builder->post('/libraryFineApi/waive',          ['controller' => 'LibraryFineApi', 'action' => 'waive']);
$builder->post('/libraryFineApi/createFine',     ['controller' => 'LibraryFineApi', 'action' => 'createFine']);
$builder->post('/libraryFineApi/reversePayment', ['controller' => 'LibraryFineApi', 'action' => 'reversePayment']);

// Receipts + cash-up
$builder->get('/libraryFineApi/receipt',           ['controller' => 'LibraryFineApi', 'action' => 'receipt']);
$builder->get('/libraryFineApi/collectionSummary', ['controller' => 'LibraryFineApi', 'action' => 'collectionSummary']);


// ══════════════════════════════════════════════════════════════════════════════
// ADMIN  →  LibraryAdminApiController
// ══════════════════════════════════════════════════════════════════════════════

$builder->get('/libraryAdminApi/dashboard', ['controller' => 'LibraryAdminApi', 'action' => 'dashboard']);

// Settings — GET maps to getSettings because the trait already owns settings()
$builder->get( '/libraryAdminApi/settings', ['controller' => 'LibraryAdminApi', 'action' => 'getSettings']);
$builder->post('/libraryAdminApi/settings', ['controller' => 'LibraryAdminApi', 'action' => 'saveSettings']);
$builder->put( '/libraryAdminApi/settings', ['controller' => 'LibraryAdminApi', 'action' => 'saveSettings']);

// Notifications queue
$builder->get( '/libraryAdminApi/notifications',     ['controller' => 'LibraryAdminApi', 'action' => 'notifications']);
$builder->post('/libraryAdminApi/markNotifications', ['controller' => 'LibraryAdminApi', 'action' => 'markNotifications']);

// Reports
$builder->get('/libraryAdminApi/reportCirculation', ['controller' => 'LibraryAdminApi', 'action' => 'reportCirculation']);
$builder->get('/libraryAdminApi/reportPopular',     ['controller' => 'LibraryAdminApi', 'action' => 'reportPopular']);
$builder->get('/libraryAdminApi/reportDeadStock',   ['controller' => 'LibraryAdminApi', 'action' => 'reportDeadStock']);
$builder->get('/libraryAdminApi/reportInventory',   ['controller' => 'LibraryAdminApi', 'action' => 'reportInventory']);
$builder->get('/libraryAdminApi/reportMembers',     ['controller' => 'LibraryAdminApi', 'action' => 'reportMembers']);

// Stocktake
$builder->get( '/libraryAdminApi/stockTakes',      ['controller' => 'LibraryAdminApi', 'action' => 'stockTakes']);
$builder->get( '/libraryAdminApi/stockTake/{id}',  ['controller' => 'LibraryAdminApi', 'action' => 'stockTake'])->setPass(['id']);
$builder->post('/libraryAdminApi/startStockTake',  ['controller' => 'LibraryAdminApi', 'action' => 'startStockTake']);
$builder->post('/libraryAdminApi/scanStockTake',   ['controller' => 'LibraryAdminApi', 'action' => 'scanStockTake']);
$builder->post('/libraryAdminApi/closeStockTake',  ['controller' => 'LibraryAdminApi', 'action' => 'closeStockTake']);

// Maintenance (cron)
$builder->post('/libraryAdminApi/reconcileCounters', ['controller' => 'LibraryAdminApi', 'action' => 'reconcileCounters']);


// ══════════════════════════════════════════════════════════════════════════════
// FACILITIES (computers & study desks)  →  LibraryFacilityApiController
// ══════════════════════════════════════════════════════════════════════════════

$builder->get(   '/libraryFacilityApi/computers',           ['controller' => 'LibraryFacilityApi', 'action' => 'computers']);
$builder->post(  '/libraryFacilityApi/saveComputer',        ['controller' => 'LibraryFacilityApi', 'action' => 'saveComputer']);
$builder->put(   '/libraryFacilityApi/saveComputer',        ['controller' => 'LibraryFacilityApi', 'action' => 'saveComputer']);
$builder->delete('/libraryFacilityApi/deleteComputer/{id}', ['controller' => 'LibraryFacilityApi', 'action' => 'deleteComputer'])->setPass(['id']);

$builder->get( '/libraryFacilityApi/availability', ['controller' => 'LibraryFacilityApi', 'action' => 'availability']);
$builder->get( '/libraryFacilityApi/bookings',     ['controller' => 'LibraryFacilityApi', 'action' => 'bookings']);
$builder->post('/libraryFacilityApi/saveBooking',  ['controller' => 'LibraryFacilityApi', 'action' => 'saveBooking']);
$builder->put( '/libraryFacilityApi/saveBooking',  ['controller' => 'LibraryFacilityApi', 'action' => 'saveBooking']);
$builder->post('/libraryFacilityApi/checkIn',      ['controller' => 'LibraryFacilityApi', 'action' => 'checkIn']);
$builder->post('/libraryFacilityApi/checkOut',     ['controller' => 'LibraryFacilityApi', 'action' => 'checkOut']);
$builder->post('/libraryFacilityApi/cancelBooking',['controller' => 'LibraryFacilityApi', 'action' => 'cancelBooking']);

// Maintenance (cron — every few minutes during opening hours)
$builder->post('/libraryFacilityApi/sweepNoShows', ['controller' => 'LibraryFacilityApi', 'action' => 'sweepNoShows']);


// ══════════════════════════════════════════════════════════════════════════════
// SERIALS (periodicals)  →  LibrarySerialApiController
// ══════════════════════════════════════════════════════════════════════════════

$builder->get(   '/librarySerialApi/periodicals',           ['controller' => 'LibrarySerialApi', 'action' => 'periodicals']);
$builder->get(   '/librarySerialApi/periodical/{id}',       ['controller' => 'LibrarySerialApi', 'action' => 'periodical'])->setPass(['id']);
$builder->post(  '/librarySerialApi/savePeriodical',        ['controller' => 'LibrarySerialApi', 'action' => 'savePeriodical']);
$builder->put(   '/librarySerialApi/savePeriodical',        ['controller' => 'LibrarySerialApi', 'action' => 'savePeriodical']);
$builder->delete('/librarySerialApi/deletePeriodical/{id}', ['controller' => 'LibrarySerialApi', 'action' => 'deletePeriodical'])->setPass(['id']);

$builder->get(   '/librarySerialApi/issues',          ['controller' => 'LibrarySerialApi', 'action' => 'issues']);
$builder->post(  '/librarySerialApi/saveIssue',       ['controller' => 'LibrarySerialApi', 'action' => 'saveIssue']);
$builder->put(   '/librarySerialApi/saveIssue',       ['controller' => 'LibrarySerialApi', 'action' => 'saveIssue']);
$builder->delete('/librarySerialApi/deleteIssue/{id}',['controller' => 'LibrarySerialApi', 'action' => 'deleteIssue'])->setPass(['id']);

$builder->get('/librarySerialApi/expiring', ['controller' => 'LibrarySerialApi', 'action' => 'expiring']);
$builder->get('/librarySerialApi/filters',  ['controller' => 'LibrarySerialApi', 'action' => 'filters']);


// ══════════════════════════════════════════════════════════════════════════════
// ACQUISITIONS  →  LibraryAcquisitionApiController
// ══════════════════════════════════════════════════════════════════════════════

$builder->get(   '/libraryAcquisitionApi/acquisitions',           ['controller' => 'LibraryAcquisitionApi', 'action' => 'acquisitions']);
$builder->get(   '/libraryAcquisitionApi/acquisition/{id}',       ['controller' => 'LibraryAcquisitionApi', 'action' => 'acquisition'])->setPass(['id']);
$builder->post(  '/libraryAcquisitionApi/saveAcquisition',        ['controller' => 'LibraryAcquisitionApi', 'action' => 'saveAcquisition']);
$builder->put(   '/libraryAcquisitionApi/saveAcquisition',        ['controller' => 'LibraryAcquisitionApi', 'action' => 'saveAcquisition']);
$builder->post(  '/libraryAcquisitionApi/setStatus',              ['controller' => 'LibraryAcquisitionApi', 'action' => 'setStatus']);
$builder->post(  '/libraryAcquisitionApi/receive',                ['controller' => 'LibraryAcquisitionApi', 'action' => 'receive']);
$builder->delete('/libraryAcquisitionApi/deleteAcquisition/{id}', ['controller' => 'LibraryAcquisitionApi', 'action' => 'deleteAcquisition'])->setPass(['id']);
$builder->get(   '/libraryAcquisitionApi/filters',                ['controller' => 'LibraryAcquisitionApi', 'action' => 'filters']);


// ══════════════════════════════════════════════════════════════════════════════
// READING PROGRAMMES  →  LibraryProgramApiController
// ══════════════════════════════════════════════════════════════════════════════

$builder->get(   '/libraryProgramApi/programs',          ['controller' => 'LibraryProgramApi', 'action' => 'programs']);
$builder->get(   '/libraryProgramApi/program/{id}',      ['controller' => 'LibraryProgramApi', 'action' => 'program'])->setPass(['id']);
$builder->post(  '/libraryProgramApi/saveProgram',       ['controller' => 'LibraryProgramApi', 'action' => 'saveProgram']);
$builder->put(   '/libraryProgramApi/saveProgram',       ['controller' => 'LibraryProgramApi', 'action' => 'saveProgram']);
$builder->delete('/libraryProgramApi/deleteProgram/{id}',['controller' => 'LibraryProgramApi', 'action' => 'deleteProgram'])->setPass(['id']);

$builder->get(   '/libraryProgramApi/participants',   ['controller' => 'LibraryProgramApi', 'action' => 'participants']);
$builder->get(   '/libraryProgramApi/logs',           ['controller' => 'LibraryProgramApi', 'action' => 'logs']);
$builder->post(  '/libraryProgramApi/saveLog',        ['controller' => 'LibraryProgramApi', 'action' => 'saveLog']);
$builder->put(   '/libraryProgramApi/saveLog',        ['controller' => 'LibraryProgramApi', 'action' => 'saveLog']);
$builder->delete('/libraryProgramApi/deleteLog/{id}', ['controller' => 'LibraryProgramApi', 'action' => 'deleteLog'])->setPass(['id']);
$builder->get(   '/libraryProgramApi/loggableLoans',  ['controller' => 'LibraryProgramApi', 'action' => 'loggableLoans']);


// ══════════════════════════════════════════════════════════════════════════════
// STAFF ACCOUNTS  →  LibraryUserApiController
//
// Owner-only. Writes to sawera_ssms_users, so it is deliberately the smallest
// surface that does the job: list, save, activate/deactivate. No delete —
// accounts are deactivated so the audit trail keeps pointing at a real person.
// ══════════════════════════════════════════════════════════════════════════════

$builder->get( '/libraryUserApi/users',         ['controller' => 'LibraryUserApi', 'action' => 'users']);
$builder->post('/libraryUserApi/saveUser',      ['controller' => 'LibraryUserApi', 'action' => 'saveUser']);
$builder->put( '/libraryUserApi/saveUser',      ['controller' => 'LibraryUserApi', 'action' => 'saveUser']);
$builder->post('/libraryUserApi/setUserStatus', ['controller' => 'LibraryUserApi', 'action' => 'setUserStatus']);
     


  //═══════════════════════════════════════════════════════════════════════════════
 //HomeworkApi
  //───────────────────────────────────────────────────────────────────────────────
 $builder->post('/HomeworkApi/create',        ['controller'=>'HomeworkApi','action'=>'create']);
 $builder->get('/HomeworkApi/list',            ['controller'=>'HomeworkApi','action'=>'listHomework']);
 $builder->get('/HomeworkApi/detail/:id',      ['controller'=>'HomeworkApi','action'=>'detail'])->setPass(['id']);
 $builder->post('/HomeworkApi/markStudent',    ['controller'=>'HomeworkApi','action'=>'markStudent']);
 $builder->post('/HomeworkApi/markStudents',   ['controller'=>'HomeworkApi','action'=>'markStudents']);
 $builder->get('/HomeworkApi/studentView',     ['controller'=>'HomeworkApi','action'=>'studentView']);
 $builder->put('/HomeworkApi/update/:id',      ['controller'=>'HomeworkApi','action'=>'update'])->setPass(['id']);
 $builder->post('/HomeworkApi/update/:id',     ['controller'=>'HomeworkApi','action'=>'update'])->setPass(['id']);
 $builder->delete('/HomeworkApi/delete/:id',   ['controller'=>'HomeworkApi','action'=>'delete'])->setPass(['id']);
 $builder->post('/HomeworkApi/delete/:id',     ['controller'=>'HomeworkApi','action'=>'delete'])->setPass(['id']);      
 
$builder->get('/NoticeApi/list',        ['controller'=>'NoticeApi','action'=>'list']);
$builder->post('/NoticeApi/create',     ['controller'=>'NoticeApi','action'=>'create']);
$builder->post('/NoticeApi/update/:id', ['controller'=>'NoticeApi','action'=>'update'])->setPass(['id']);
$builder->post('/NoticeApi/delete/:id', ['controller'=>'NoticeApi','action'=>'delete'])->setPass(['id']);     

//═══════════════════════════════════════════════════════════════════════════════
 //SchoolGalleryApi
//───────────────────────────────────────────────────────────────────────────────
$builder->get( '/SchoolGalleryApi/getPhotos',   ['controller'=>'SchoolGalleryApi','action'=>'getPhotos']);
$builder->post('/SchoolGalleryApi/uploadPhoto', ['controller'=>'SchoolGalleryApi','action'=>'uploadPhoto']);
$builder->post('/SchoolGalleryApi/deletePhoto', ['controller'=>'SchoolGalleryApi','action'=>'deletePhoto']);

//═══════════════════════════════════════════════════════════════════════════════
// Homework (web UI)
//───────────────────────────────────────────────────────────────────────────────
$builder->connect('/homework',              ['controller'=>'SsmsHomework','action'=>'index']);
$builder->connect('/homework/add',          ['controller'=>'SsmsHomework','action'=>'add']);
$builder->connect('/homework/mark/{id}',    ['controller'=>'SsmsHomework','action'=>'markStudents'])->setPass(['id']);
$builder->connect('/homework/close/{id}',   ['controller'=>'SsmsHomework','action'=>'close'])->setPass(['id']);
$builder->connect('/homework/delete/{id}',  ['controller'=>'SsmsHomework','action'=>'delete'])->setPass(['id']);

//═══════════════════════════════════════════════════════════════════════════════
// Notice Board (web UI)
//───────────────────────────────────────────────────────────────────────────────
$builder->connect('/notices',              ['controller'=>'SsmsNotices','action'=>'index']);
$builder->connect('/notices/add',          ['controller'=>'SsmsNotices','action'=>'add']);
$builder->connect('/notices/edit/{id}',    ['controller'=>'SsmsNotices','action'=>'edit'])->setPass(['id']);
$builder->connect('/notices/delete/{id}',  ['controller'=>'SsmsNotices','action'=>'delete'])->setPass(['id']);
$builder->connect('/notices/pin/{id}',     ['controller'=>'SsmsNotices','action'=>'pin'])->setPass(['id']);

//═══════════════════════════════════════════════════════════════════════════════
// School Gallery (web UI)
//───────────────────────────────────────────────────────────────────────────────
$builder->connect('/gallery',              ['controller'=>'SsmsSchoolGallery','action'=>'index']);
$builder->connect('/gallery/upload',       ['controller'=>'SsmsSchoolGallery','action'=>'upload']);
$builder->connect('/gallery/delete/{id}',  ['controller'=>'SsmsSchoolGallery','action'=>'delete'])->setPass(['id']);

// Hostel Fee Structure
$builder->connect('/hostel-fee-structure',  ['controller'=>'SsmsHostelFeeStructure','action'=>'index']);

// Transport Fee Structure
$builder->connect('/transport-fee-structure', ['controller'=>'SsmsTransportFeeStructure','action'=>'index']);

// Quick Test Setup
$builder->connect('/quick-test',              ['controller'=>'SsmsQuickTest','action'=>'index']);
$builder->connect('/quick-test/get-sections', ['controller'=>'SsmsQuickTest','action'=>'getSections']);

// Paper Builder
$builder->connect('/papers',                ['controller'=>'SsmsQuestionPaper','action'=>'index']);
$builder->connect('/papers/add',            ['controller'=>'SsmsQuestionPaper','action'=>'add']);
$builder->connect('/papers/edit/{id}',      ['controller'=>'SsmsQuestionPaper','action'=>'edit'])->setPass(['id']);
$builder->connect('/papers/view/{id}',      ['controller'=>'SsmsQuestionPaper','action'=>'view'])->setPass(['id']);
$builder->connect('/papers/delete/{id}',    ['controller'=>'SsmsQuestionPaper','action'=>'delete'])->setPass(['id']);
$builder->connect('/papers/publish/{id}',   ['controller'=>'SsmsQuestionPaper','action'=>'publish'])->setPass(['id']);
$builder->connect('/papers/preview/{id}',   ['controller'=>'SsmsQuestionPaper','action'=>'preview'])->setPass(['id']);

// Student Login Account Management
$builder->connect('/student-accounts', ['controller'=>'SsmsStudentAccounts','action'=>'index']);

       
// Question Bank
$builder->get('/QuestionBankApi/getQuestions',            ['controller'=>'QuestionBankApi','action'=>'getQuestions']);
$builder->post('/QuestionBankApi/createQuestion',          ['controller'=>'QuestionBankApi','action'=>'createQuestion']);
$builder->post('/QuestionBankApi/updateQuestion', ['controller'=>'QuestionBankApi','action'=>'updateQuestion']);
$builder->post('/QuestionBankApi/deleteQuestion', ['controller'=>'QuestionBankApi','action'=>'deleteQuestion']);
$builder->get('/QuestionBankApi/getQuestions',   ['controller'=>'QuestionBankApi','action'=>'getQuestions']);
// Question Papers
$builder->get('/QuestionPaperApi/getPapers',                    ['controller'=>'QuestionPaperApi','action'=>'getPapers']);
$builder->post('/QuestionPaperApi/createPaper',                 ['controller'=>'QuestionPaperApi','action'=>'createPaper']);
$builder->post('/QuestionPaperApi/updatePaper/:id',             ['controller'=>'QuestionPaperApi','action'=>'updatePaper'])->setPass(['id']);
$builder->delete('/QuestionPaperApi/deletePaper/:id',           ['controller'=>'QuestionPaperApi','action'=>'deletePaper'])->setPass(['id']);
$builder->post('/QuestionPaperApi/deletePaper/:id',             ['controller'=>'QuestionPaperApi','action'=>'deletePaper'])->setPass(['id']);
$builder->get('/QuestionPaperApi/getPaper/:id',                 ['controller'=>'QuestionPaperApi','action'=>'getPaper'])->setPass(['id']);
$builder->post('/QuestionPaperApi/addQuestion/:id',             ['controller'=>'QuestionPaperApi','action'=>'addQuestion'])->setPass(['id']);
$builder->post('/QuestionPaperApi/updateQuestion/:id/:pqId',    ['controller'=>'QuestionPaperApi','action'=>'updatePaperQuestion'])->setPass(['id','pqId']);
$builder->delete('/QuestionPaperApi/removeQuestion/:id/:pqId',  ['controller'=>'QuestionPaperApi','action'=>'removeQuestion'])->setPass(['id','pqId']);
$builder->post('/QuestionPaperApi/removeQuestion/:id/:pqId',    ['controller'=>'QuestionPaperApi','action'=>'removeQuestion'])->setPass(['id','pqId']);
$builder->post('/QuestionPaperApi/publishPaper/:id',            ['controller'=>'QuestionPaperApi','action'=>'publishPaper'])->setPass(['id']);
$builder->get('/QuestionPaperApi/exportDocx/:id',               ['controller'=>'QuestionPaperApi','action'=>'exportDocx'])->setPass(['id']);
// Test Series — Admin / Teacher
$builder->post('/TestSeriesApi/createSeries',      ['controller'=>'TestSeriesApi','action'=>'createSeries']);
$builder->get('/TestSeriesApi/getSeriesList',       ['controller'=>'TestSeriesApi','action'=>'getSeriesList']);
$builder->post('/TestSeriesApi/updateSeries',       ['controller'=>'TestSeriesApi','action'=>'updateSeries']);
$builder->post('/TestSeriesApi/deleteSeries',       ['controller'=>'TestSeriesApi','action'=>'deleteSeries']);
$builder->post('/TestSeriesApi/createTest',         ['controller'=>'TestSeriesApi','action'=>'createTest']);
$builder->get('/TestSeriesApi/getTestsBySeriesId',  ['controller'=>'TestSeriesApi','action'=>'getTestsBySeriesId']);
$builder->post('/TestSeriesApi/updateTest',         ['controller'=>'TestSeriesApi','action'=>'updateTest']);
$builder->post('/TestSeriesApi/deleteTest',         ['controller'=>'TestSeriesApi','action'=>'deleteTest']);
$builder->post('/TestSeriesApi/addSection',         ['controller'=>'TestSeriesApi','action'=>'addSection']);
$builder->get('/TestSeriesApi/getSections',         ['controller'=>'TestSeriesApi','action'=>'getSections']);
$builder->post('/TestSeriesApi/deleteSection',      ['controller'=>'TestSeriesApi','action'=>'deleteSection']);
$builder->post('/TestSeriesApi/addQuestions',       ['controller'=>'TestSeriesApi','action'=>'addQuestions']);
$builder->post('/TestSeriesApi/removeQuestion',     ['controller'=>'TestSeriesApi','action'=>'removeQuestion']);
$builder->get('/TestSeriesApi/getTestQuestions',    ['controller'=>'TestSeriesApi','action'=>'getTestQuestions']);
$builder->post('/TestSeriesApi/publishTest',        ['controller'=>'TestSeriesApi','action'=>'publishTest']);
$builder->get('/TestSeriesApi/getTestAttempts',     ['controller'=>'TestSeriesApi','action'=>'getTestAttempts']);
$builder->get('/TestSeriesApi/getBatchAnalysis',    ['controller'=>'TestSeriesApi','action'=>'getBatchAnalysis']);
// Test Series — Student
$builder->get('/TestSeriesApi/getMySeriesList',     ['controller'=>'TestSeriesApi','action'=>'getMySeriesList']);
$builder->get('/TestSeriesApi/getMyTests',          ['controller'=>'TestSeriesApi','action'=>'getMyTests']);
$builder->post('/TestSeriesApi/startAttempt',       ['controller'=>'TestSeriesApi','action'=>'startAttempt']);
$builder->post('/TestSeriesApi/saveResponses',      ['controller'=>'TestSeriesApi','action'=>'saveResponses']);
$builder->post('/TestSeriesApi/submitAttempt',      ['controller'=>'TestSeriesApi','action'=>'submitAttempt']);
$builder->get('/TestSeriesApi/getResult',           ['controller'=>'TestSeriesApi','action'=>'getResult']);
$builder->get('/TestSeriesApi/getAnalysis',         ['controller'=>'TestSeriesApi','action'=>'getAnalysis']);
$builder->get('/TestSeriesApi/getLeaderboard',      ['controller'=>'TestSeriesApi','action'=>'getLeaderboard']);
$builder->get('/TestSeriesApi/getChapters',         ['controller'=>'TestSeriesApi','action'=>'getChapters']);
$builder->post('/TestSeriesApi/createChapter',       ['controller'=>'TestSeriesApi','action'=>'createChapter']);
$builder->post('/TestSeriesApi/updateChapter/:id',   ['controller'=>'TestSeriesApi','action'=>'updateChapter']);
$builder->delete('/TestSeriesApi/deleteChapter/:id', ['controller'=>'TestSeriesApi','action'=>'deleteChapter']);
// ChatApi
$builder->get('/ChatApi/getUsers',        ['controller'=>'ChatApi','action'=>'getUsers']);
$builder->post('/ChatApi/heartbeat',       ['controller'=>'ChatApi','action'=>'heartbeat']);
$builder->get('/ChatApi/getConversations', ['controller'=>'ChatApi','action'=>'getConversations']);
$builder->get('/ChatApi/getMessages',      ['controller'=>'ChatApi','action'=>'getMessages']);
$builder->post('/ChatApi/sendMessage',     ['controller'=>'ChatApi','action'=>'sendMessage']);
     
// ── Leave Management ──────────────────────────────────────────────────────────
$builder->get('/LeaveApi/getLeaveTypes',    ['controller' => 'LeaveApi', 'action' => 'getLeaveTypes']);
$builder->post('/LeaveApi/saveLeaveType',   ['controller' => 'LeaveApi', 'action' => 'saveLeaveType']);
$builder->post('/LeaveApi/applyLeave',      ['controller' => 'LeaveApi', 'action' => 'applyLeave']);
$builder->get('/LeaveApi/getMyLeaves',      ['controller' => 'LeaveApi', 'action' => 'getMyLeaves']);
$builder->get('/LeaveApi/getPendingLeaves', ['controller' => 'LeaveApi', 'action' => 'getPendingLeaves']);
$builder->get('/LeaveApi/getAllLeaves',      ['controller' => 'LeaveApi', 'action' => 'getAllLeaves']);
$builder->post('/LeaveApi/approveLeave',    ['controller' => 'LeaveApi', 'action' => 'approveLeave']);
$builder->post('/LeaveApi/cancelLeave',     ['controller' => 'LeaveApi', 'action' => 'cancelLeave']);
$builder->get('/LeaveApi/getLeaveBalance',  ['controller' => 'LeaveApi', 'action' => 'getLeaveBalance']);
       /*
        * 
         * Connect catchall routes for all controllers.
         *
         * The `fallbacks` method is a shortcut for
         *
         * ```
         * $builder->connect('/{controller}', ['action' => 'index']);
         * $builder->connect('/{controller}/{action}/*', []);
         * ```
         *
         * It is NOT recommended to use fallback routes after your initial prototyping phase!
         * See https://book.cakephp.org/5/en/development/routing.html#fallbacks-method for more information
         */
        $builder->fallbacks();
    });

    /*
     * If you need a different set of middleware or none at all,
     * open new scope and define routes there.
     *
     * ```
     * $routes->scope('/StudentApi', function (RouteBuilder $builder): void {
     *     // No $builder->applyMiddleware() here.
     *
     *     // Parse specified extensions from URLs
     *     // $builder->setExtensions(['json', 'xml']);
     *
     *     // Connect StudentApi actions here.
     * });
     * ```
     */
};
