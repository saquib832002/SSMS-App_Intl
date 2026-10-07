<?php
declare(strict_types=1);

/**
 * CakePHP(tm) : Rapid Development Framework (https://cakephp.org)
 * Copyright (c) Cake Software Foundation, Inc. (https://cakefoundation.org)
 *
 * Licensed under The MIT License
 * For full copyright and license information, please see the LICENSE.txt
 * Redistributions of files must retain the above copyright notice.
 *
 * @copyright Copyright (c) Cake Software Foundation, Inc. (https://cakefoundation.org)
 * @link      https://cakephp.org CakePHP(tm) Project
 * @since     3.3.0
 * @license   https://opensource.org/licenses/mit-license.php MIT License
 */
namespace App;

use Cake\Core\Configure;
use Cake\Core\ContainerInterface;
use Cake\Datasource\FactoryLocator;
use Cake\Error\Middleware\ErrorHandlerMiddleware;
use Cake\Http\BaseApplication;
use Cake\Http\Middleware\BodyParserMiddleware;
use Cake\Http\Middleware\CsrfProtectionMiddleware;
use Cake\Http\MiddlewareQueue;
use Cake\ORM\Locator\TableLocator;
use Cake\Routing\Middleware\AssetMiddleware;
use Cake\Routing\Middleware\RoutingMiddleware;

use Authentication\AuthenticationService;
use Authentication\AuthenticationServiceInterface;
use Authentication\AuthenticationServiceProviderInterface;
use Authentication\Middleware\AuthenticationMiddleware;
use Cake\Routing\Router;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Application setup class.
 *
 * This defines the bootstrapping logic and middleware layers you
 * want to use in your application.
 *
 * @extends \Cake\Http\BaseApplication<\App\Application>
 */
class Application extends BaseApplication implements AuthenticationServiceProviderInterface
{
    /**
     * Load all the application configuration and bootstrap logic.
     *
     * @return void
     */
    public function bootstrap(): void
    {
        // Call parent to load bootstrap from files.
        parent::bootstrap();
        $this->addPlugin('Authentication');  // ← required for AuthenticationMiddleware

        if (PHP_SAPI !== 'cli') {
            FactoryLocator::add(
                'Table',
                (new TableLocator())->allowFallbackClass(false)
            );
        }
    }

    /**
     * Setup the middleware queue your application will use.
     *
     * @param \Cake\Http\MiddlewareQueue $middlewareQueue The middleware queue to setup.
     * @return \Cake\Http\MiddlewareQueue The updated middleware queue.
     */
    public function middleware(MiddlewareQueue $middlewareQueue): MiddlewareQueue
    {
            $csrf = new CsrfProtectionMiddleware([
            'httponly' => true,
            ]);

        $middlewareQueue
            // Catch any exceptions in the lower layers,
            // and make an error page/response
            ->add(new ErrorHandlerMiddleware(Configure::read('Error'), $this))

            // Handle plugin/theme assets like CakePHP normally does.
            ->add(new AssetMiddleware([
                'cacheTime' => Configure::read('Asset.cacheTime'),
            ]))

            // Add routing middleware.
            // If you have a large number of routes connected, turning on routes
            // caching in production could improve performance.
            // See https://github.com/CakeDC/cakephp-cached-routing
            ->add(new RoutingMiddleware($this))

            // Parse various types of encoded request bodies so that they are
            // available as array through $request->getData()
            // https://book.cakephp.org/5/en/controllers/middleware.html#body-parser-middleware
            ->add(new BodyParserMiddleware())
			

            // Cross Site Request Forgery (CSRF) Protection Middleware
            // https://book.cakephp.org/5/en/security/csrf.html#cross-site-request-forgery-csrf-middleware
    
            ->add(new \App\Middleware\JwtAuthMiddleware())
            ->add(function ($request, $handler) use ($csrf) {
                $path = $request->getUri()->getPath();
                // Skip CSRF for ALL API routes — JWT handles auth for these
                $isApi = (bool) preg_match(
                    '#/(UserServiceApi|StudentApi|FeeApi|SetupServiceApi|HostelServiceApi|StaffServiceApi|SubjectServiceApi|ExamServiceApi|TransportServiceApi|TimeTableServiceApi|SchoolEventsApi|HomeworkApi|NoticeApi|SchoolGalleryApi|SchoolSettingsServiceApi|DatesheetApi|QuestionPaperApi|QuestionBankApi|TestSeriesApi|ChatApi|CertificateApi|LeaveApi|LibraryCatalogApi|LibraryMemberApi|LibraryCirculationApi|LibraryFineApi|LibraryAdminApi|LibraryFacilityApi|LibrarySerialApi|LibraryAcquisitionApi|LibraryProgramApi|LibraryUserApi|SubscriptionApi)/#i',
                    $path
                );
                // Skip CSRF for superuser AJAX endpoints (session-protected)
                $isAdminAjax = in_array($path, [
                    '/admin/toggle-user-status',
                    '/admin/send-marketing-email',
                ], true);
                if ($isApi || $isAdminAjax) {
                    return $handler->handle($request);
                }
                return $csrf->process($request, $handler);
            })
            
            
			->add(new AuthenticationMiddleware($this));

        return $middlewareQueue;
    }

    /**
     * Register application container services.
     *
     * @param \Cake\Core\ContainerInterface $container The Container to update.
     * @return void
     * @link https://book.cakephp.org/5/en/development/dependency-injection.html#dependency-injection
     */
    public function services(ContainerInterface $container): void
    {
    }
	
	/*public function getAuthenticationService(ServerRequestInterface $request): AuthenticationServiceInterface
	{
    $service = new AuthenticationService();

		// Load identifiers
	
		
    // Define where users should be redirected to when they are not authenticated
   $service->setConfig([
        'unauthenticatedRedirect' => [
                'prefix' => false,
                'plugin' => false,
                'controller' => 'SaweraSsmsUsers',
                'action' => 'login',
        ],
        'queryParam' => 'redirect',
    ]);

   // $fields = [
     //   AbstractIdentifier::CREDENTIAL_USERNAME => 'ssms_user_name',
     //   AbstractIdentifier::CREDENTIAL_PASSWORD => 'ssms_user_password'
    //];
	$service->loadIdentifier('Authentication.Password', [
    'resolver' => [
        'className' => 'Authentication.Orm',
        'userModel' => 'SaweraSsmsUsers',
    ],
    'fields' => [
        'ssms_user_name' => 'ssms_user_name',
        'ssms_user_password' => 'ssms_user_password',
    ]
]);
		
    // Load the authenticators. Session should be first.
   // $service->loadAuthenticator('Authentication.Session');
//    $service->loadAuthenticator('Authentication.Form', [
//        'fields' => $fields,
//        'loginUrl' => Router::url([
//            'prefix' => false,
//            'plugin' => null,
//            'controller' => 'SaweraSsmsUsers',
//            'action' => 'login',
//        ]),
//    ]);

    $service->loadAuthenticator('Authentication.Form', [
    'resolver' => [
        'className' => 'Authentication.Orm',
        'userModel' => 'SaweraSsmsUsers',
    ],
    'fields' => [
        'ssms_user_name' => 'ssms_user_name',
        'ssms_user_password' => 'ssms_user_password',
    ]
]);
   //$service->loadIdentifier('Authentication.Password', compact('fields'));
	//print_r($service);
    return $service;
	} */
	
    public function getAuthenticationService(ServerRequestInterface $request): AuthenticationServiceInterface
    {
        $path = $request->getUri()->getPath();

        // ── API routes — return minimal service with NO redirect ──────────────
        // AuthenticationMiddleware must still run to set the `authentication`
        // attribute (required by AuthenticationComponent on web controllers).
        // For API routes: unauthenticatedRedirect = null prevents any redirect.
        $isApi = (bool) preg_match(
            '#/(UserServiceApi|StudentApi|FeeApi|SetupServiceApi|HostelServiceApi|StaffServiceApi|DashboardServiceApi|SubjectServiceApi|ExamServiceApi|TransportServiceApi|TimeTableServiceApi|SchoolEventsApi|HomeworkApi|NoticeApi|SchoolGalleryApi|SchoolSettingsServiceApi|DatesheetApi|QuestionPaperApi|QuestionBankApi|TestSeriesApi|ChatApi|CertificateApi|LeaveApi|LibraryCatalogApi|LibraryMemberApi|LibraryCirculationApi|LibraryFineApi|LibraryAdminApi|LibraryFacilityApi|LibrarySerialApi|LibraryAcquisitionApi|LibraryProgramApi|SubscriptionApi)/#i',
            $path
        );

        // Public student registration page — no redirect (matches /students/studReg or /students/stud-reg)
        $isPublicStudReg = (bool) preg_match('#/students/stud.?reg#i', $path);

        if ($isApi || $isPublicStudReg) {
            $service = new AuthenticationService([
                'unauthenticatedRedirect' => null,
                'queryParam'              => null,
            ]);
            $service->loadAuthenticator('Authentication.Session');
            return $service;
        }

        // ── Web routes — standard session auth ───────────────────────────────
        $authenticationService = new AuthenticationService([
            'unauthenticatedRedirect' => Router::url('/login'),
            'queryParam'              => 'redirect',
        ]);

        $authenticationService->loadIdentifier('Authentication.Password', [
            'resolver' => [
                'className' => 'Authentication.Orm',
                'userModel' => 'SaweraSsmsUsers',
            ],
            'fields' => [
                'username' => 'ssms_user_name',
                'password' => 'ssms_user_password',
            ],
        ]);

        $authenticationService->loadAuthenticator('Authentication.Session');
        $authenticationService->loadAuthenticator('Authentication.Form', [
            'fields' => [
                'username' => 'ssms_user_name',
                'password' => 'ssms_user_password',
            ],
            'loginUrl' => Router::url('/login'),
        ]);

        return $authenticationService;
    }
}