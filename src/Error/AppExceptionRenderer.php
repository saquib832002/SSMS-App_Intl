<?php
declare(strict_types=1);

namespace App\Error;

use Cake\Core\Configure;
use Cake\Error\Renderer\WebExceptionRenderer;

/**
 * AppExceptionRenderer
 *
 * Suppresses raw debug output for all exceptions so users always
 * see a styled, friendly error page instead of a stack trace.
 * Exceptions are still logged normally.
 */
class AppExceptionRenderer extends WebExceptionRenderer
{
    /**
     * Always render the friendly (non-debug) templates.
     */
    public function render(): \Psr\Http\Message\ResponseInterface
    {
        // Force non-debug rendering regardless of environment setting.
        // Errors still go to the log files — only the HTML output changes.
        Configure::write('debug', false);

        return parent::render();
    }
}
