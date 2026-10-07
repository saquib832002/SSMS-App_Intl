<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Controller\Controller;
use Cake\Event\EventInterface;

class AppController extends Controller
{
    public function initialize(): void
    {
        parent::initialize();
        $this->loadComponent('Flash');

        // Authentication plugin must be loaded in Application::bootstrap()
        // loadPlugin('Authentication') — if missing this will 500
        $this->loadComponent('Authentication.Authentication');
    }

    public function beforeFilter(EventInterface $event): void
    {
        parent::beforeFilter($event);

        // DEBUG — remove after fixing
        \Cake\Log\Log::error('AppController::beforeFilter controller=' .
            $this->request->getParam('controller') . ' action=' .
            $this->request->getParam('action'));
        // ── API controllers — JWT middleware handles auth ─────────────────────
        // AuthenticationComponent must allowUnauthenticated for all actions
        // otherwise it blocks every API request with a redirect
        $apiControllers = [
            'FeeApi',
            'UserServiceApi',
            'StudentApi',
            'SetupServiceApi',
            'HostelServiceApi',
            'StaffServiceApi',
            'DashboardServiceApi',
            'SubjectServiceApi',
            'ExamServiceApi',
            'TransportServiceApi',
            'TimeTableServiceApi',
            'SchoolEventsApi',
            'HomeworkApi',
            'LibraryCatalogApi', 
            'LibraryMemberApi', 
            'LibraryCirculationApi',
            'LibraryFineApi', 
            'LibraryAdminApi', 
            'LibraryFacilityApi',
            'LibrarySerialApi', 
            'LibraryAcquisitionApi', 
            'LibraryProgramApi',
            'LibraryUserApi',
            'NoticeApi',
            'SchoolGalleryApi',
            'SchoolSettingsServiceApi',
            'DatesheetApi',
            'QuestionPaperApi',
            'QuestionBankApi',
            'TestSeriesApi',
            'ChatApi',
            'CertificateApi',
            'LeaveApi',
            'SubscriptionApi',
        ];

        if (in_array($this->request->getParam('controller'), $apiControllers, true)) {
            // Allow current action + all public methods on this controller
            $actions = array_values(array_filter(
                get_class_methods($this),
                fn($m) => !str_starts_with($m, '_')
                    && !in_array($m, [
                        'initialize', 'beforeFilter', 'beforeRender',
                        'afterFilter', 'redirect', 'render',
                    ])
            ));
            $actions[] = $this->request->getParam('action');
            $this->Authentication->allowUnauthenticated(array_unique($actions));
            return;
        }

        // ── Web controllers — standard session auth ───────────────────────────
        // StudentPortal has its own unauthenticated actions (register + studentLogin)
        if ($this->request->getParam('controller') === 'StudentPortal') {
            $this->Authentication->allowUnauthenticated(['register', 'studentLogin']);
            return;
        }
        // Public student registration form (no login required)
        if ($this->request->getParam('controller') === 'SsmsStudentRegistration') {
            $this->Authentication->allowUnauthenticated(['studReg', 'login', 'logout']);
            return;
        }
        $this->Authentication->allowUnauthenticated(['login', 'logout']);

        // ── Module access guard ───────────────────────────────────────────────
        // Maps controller prefixes → required module key.
        // 'school' is always granted and never checked here.
        // Superuser bypasses all module restrictions.
        $this->_checkModuleAccess();
    }

    /**
     * Module-based access control.
     * Reads active_modules from session (written at login).
     * Redirects to dashboard with an error flash if the required module
     * is not granted to the client.
     */
    protected function _checkModuleAccess(): void
    {
        $session    = $this->request->getSession();
        $role       = $session->read('ssms_user_role');

        // Superuser has no module restrictions
        if ($role === 'superuser') return;

        $controller = $this->request->getParam('controller');

        // Controller → module key map
        // Add new entries here as new modules are introduced
        $moduleMap = [
            // Finance module
            'FinIncome'          => 'finance',
            'FinExpenses'        => 'finance',
            'FinChartOfAccounts' => 'finance',
            'FinFiscalYears'     => 'finance',
            'FinPayroll'         => 'finance',
            'FinBankAccounts'    => 'finance',
            'FinVendors'         => 'finance',
            'FinPurchaseOrders'  => 'finance',
            'FinReports'         => 'finance',
            'FinBudgets'         => 'finance',
            'SsmsFeeItems'       => 'finance',
            'SsmsFeeStructure'   => 'finance',
            'SsmsStudentDiscounts'=> 'finance',
            'SsmsFeePaidDetails' => 'finance',
            'SsmsBalancesheet'   => 'finance',

            // Library module
            'LibBooks'           => 'library',
            'LibCirculation'     => 'library',
            'LibMembers'         => 'library',
            'LibComputers'       => 'library',
            'LibFines'           => 'library',
            'LibReservations'    => 'library',

            // Donation module (future)
            'Donations'          => 'donation',
            'DonationCampaigns'  => 'donation',
        ];

        // If this controller isn't in the map, it's a school-module controller — always allowed
        if (!isset($moduleMap[$controller])) return;

        $requiredModule = $moduleMap[$controller];
        $activeModules  = (array)($session->read('active_modules') ?? ['school']);

        if (!in_array($requiredModule, $activeModules, true)) {
            $moduleLabels = [
                'finance'  => 'Finance Management',
                'library'  => 'Library Management',
                'donation' => 'Donation Management',
            ];
            $label = $moduleLabels[$requiredModule] ?? ucfirst($requiredModule);

            $this->Flash->error(
                "Your school does not have access to the {$label} module. "
                . "Please contact your system administrator to enable it."
            );
            $this->redirect(['controller' => 'Dashboards', 'action' => 'dashboard']);
        }
    }
}
