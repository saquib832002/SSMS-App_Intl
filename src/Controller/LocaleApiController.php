<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\Locale;
use App\Service\Permissions;

/**
 * LocaleApi – the school's currency, number / date / time formats, time zone and local labels (JWT, app only).
 *   GET  /LocaleApi/current       everyone signed in (staff, parents, students) – the app formats with it
 *   GET  /LocaleApi/options   lists for the settings screen (countries with presets, currencies, formats, time zones)
 *   POST /LocaleApi/save      School settings · edit
 *   POST /LocaleApi/myLanguage  everyone signed in – their own language ('' = follow the school)
 */
class LocaleApiController extends AppController
{
    use SecurityApiTrait {
        _out as private _traitOut;
    }

    private ?int $bufLevel = null;

    public function initialize(): void
    {
        parent::initialize();
        if (ob_start()) {
            $this->bufLevel = ob_get_level();
        }
    }

    protected function _out(array $data, int $status = 200)
    {
        if ($this->bufLevel !== null && ob_get_level() >= $this->bufLevel) {
            while (ob_get_level() > $this->bufLevel) {
                ob_end_flush();
            }
            $stray = (string)ob_get_clean();
            $this->bufLevel = null;
            if (trim($stray) !== '') {
                \Cake\Log\Log::warning('LocaleApi: unexpected output removed from reply: ' . mb_substr(trim(preg_replace('/\s+/', ' ', strip_tags($stray))), 0, 1000));
            }
        }

        return $this->_traitOut($data, $status);
    }

    private function bearer(): void
    {
        if (!preg_match('/^Bearer\s+\S+/i', $this->request->getHeaderLine('Authorization'))) {
            throw new \DomainException('Please sign in again.');
        }
        if ($this->_client() === '') {
            throw new \DomainException('Please sign in again.');
        }
    }

    private function canEdit(): bool
    {
        $role = $this->_role();
        if ($role === 'owner') {
            return true;
        }
        if (!in_array($role, Permissions::BASE_ROLES, true)) {
            return false;
        }
        $grid = Permissions::forUser($this->_client(), $role, $this->request->getAttribute('jwt_custom_role'));

        return !empty($grid['settings']['edit']);
    }

    public function current()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $this->bearer();

            $tz = Locale::tz($this->_client());

            return ['locale' => Locale::get($this->_client()), 'today' => Locale::today($this->_client()),
                    'utc_offset' => intdiv($tz->getOffset(new \DateTimeImmutable('now', $tz)), 60), 'can_edit' => $this->canEdit(),
                    'user_language' => Locale::userLang($this->_client(), $this->_user()), 'languages' => Locale::LANGUAGES];
        });
    }

    public function options()
    {
        $this->request->allowMethod(['get']);

        return $this->_try(function () {
            $this->bearer();
            if (in_array($this->_role(), ['parent', 'student'], true)) {
                throw new \DomainException('Not allowed.');
            }

            return Locale::options() + ['locale' => Locale::get($this->_client()), 'can_edit' => $this->canEdit()];
        });
    }

    /** Each person's own language for the app, notifications and e-mails. */
    public function myLanguage()
    {
        $this->request->allowMethod(['post']);
        return $this->_try(function () {
            $this->bearer();
            $l = Locale::saveUserLang($this->_client(), $this->_user(), (string)($this->request->getData('language') ?? ''));

            return ['user_language' => $l, 'language' => Locale::langFor($this->_client(), $this->_user())];
        });
    }

    public function save()
    {
        $this->request->allowMethod(['post']);

        return $this->_try(function () {
            $this->bearer();
            if (!$this->canEdit()) {
                throw new \DomainException("You don't have permission to change school settings.");
            }
            $r = Locale::save($this->_client(), (array)$this->request->getData(), $this->_user());
            if ($r['changed']) {
                $this->_audit('settings.locale_changed', ['category' => 'settings', 'entity_type' => 'locale', 'entity_id' => $this->_client(),
                    'summary' => 'Region & formats changed: ' . implode(', ', array_keys($r['changed'])), 'changes' => $r['changed']]);
            }

            return $r;
        });
    }
}
