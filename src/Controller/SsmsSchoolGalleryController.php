<?php
declare(strict_types=1);

namespace App\Controller;

use Cake\Datasource\ConnectionManager;
use Cake\Log\Log;

/**
 * SsmsSchoolGalleryController
 * Web UI for School Memories / Photo Gallery.
 * Mirrors the mobile app SchoolMemoriesAdminScreen + SchoolMemoriesScreen.
 *
 * DB table: ssms_school_gallery
 * Run this SQL once if table doesn't exist:
 *
 * CREATE TABLE IF NOT EXISTS ssms_school_gallery (
 *   id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 *   ssms_client_code VARCHAR(50)   NOT NULL,
 *   file_name        VARCHAR(255)  NOT NULL,
 *   caption          VARCHAR(255)  DEFAULT NULL,
 *   uploaded_by      VARCHAR(100)  DEFAULT NULL,
 *   sort_order       INT           NOT NULL DEFAULT 0,
 *   created          DATETIME      DEFAULT CURRENT_TIMESTAMP,
 *   status           ENUM('active','deleted') NOT NULL DEFAULT 'active',
 *   INDEX idx_client_status (ssms_client_code, status, created)
 * ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 *
 * Photos stored at: {htdocs}/webroot/clients/{clientCode}/gallery/{filename}
 */
class SsmsSchoolGalleryController extends AppController
{
    private const MAX_BYTES     = 5 * 1024 * 1024; // 5 MB
    private const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    private const PHOTO_LIMIT   = 50; // per school (can be raised)

    private function db(): \Cake\Database\Connection
    {
        return ConnectionManager::get('default');
    }

    private function session(): \Cake\Http\Session
    {
        return $this->request->getSession();
    }

    private function galleryDir(string $clientCode): string
    {
        return WWW_ROOT . 'clients' . DS . $clientCode . DS . 'gallery' . DS;
    }

    private function isAdmin(): bool
    {
        $role = strtolower((string)$this->session()->read('ssms_user_role'));
        return in_array($role, ['admin', 'owner', 'teacher'], true);
    }

    // ── index: photo grid + upload form (admin) ───────────────────────────────
    public function index()
    {
        $session    = $this->session();
        $clientCode = $session->read('ssms_client_code');
        $isAdmin    = $this->isAdmin();

        $photos = $this->db()->execute(
            "SELECT * FROM ssms_school_gallery
             WHERE ssms_client_code = ? AND status = 'active'
             ORDER BY sort_order ASC, created DESC",
            [$clientCode]
        )->fetchAll('assoc');

        // Build public URL for each photo
        $photoBase = '/clients/' . $clientCode . '/gallery/';
        foreach ($photos as &$p) {
            $p['url'] = $photoBase . $p['file_name'];
        }
        unset($p);

        $photoCount = count($photos);
        $atLimit    = $photoCount >= self::PHOTO_LIMIT;

        $this->set(compact('photos', 'isAdmin', 'photoCount', 'atLimit'));
    }

    // ── upload: POST only ─────────────────────────────────────────────────────
    public function upload()
    {
        $this->request->allowMethod(['post']);
        $session    = $this->session();
        $clientCode = $session->read('ssms_client_code');
        $userName   = $session->read('ssms_user_name');

        if (!$this->isAdmin()) {
            $this->Flash->error('You do not have permission to upload photos.');
            return $this->redirect(['action' => 'index']);
        }

        // Check limit
        $count = (int)$this->db()->execute(
            "SELECT COUNT(*) AS n FROM ssms_school_gallery WHERE ssms_client_code = ? AND status = 'active'",
            [$clientCode]
        )->fetchAssoc()['n'];

        if ($count >= self::PHOTO_LIMIT) {
            $this->Flash->error('Photo limit reached. Delete some photos to upload more.');
            return $this->redirect(['action' => 'index']);
        }

        $file    = $this->request->getUploadedFile('photo');
        $caption = trim((string)($this->request->getData('caption') ?? ''));

        if (!$file || $file->getError() !== UPLOAD_ERR_OK) {
            $this->Flash->error('No file uploaded or upload failed.');
            return $this->redirect(['action' => 'index']);
        }

        if ($file->getSize() > self::MAX_BYTES) {
            $this->Flash->error('File too large. Maximum size is 5 MB.');
            return $this->redirect(['action' => 'index']);
        }

        $mime = $file->getClientMediaType();
        if (!in_array($mime, self::ALLOWED_TYPES, true)) {
            $this->Flash->error('Only JPG, PNG, GIF, and WebP images are allowed.');
            return $this->redirect(['action' => 'index']);
        }

        // Build save path
        $dir = $this->galleryDir($clientCode);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $ext      = pathinfo($file->getClientFilename(), PATHINFO_EXTENSION) ?: 'jpg';
        $fileName = uniqid('gallery_', true) . '.' . strtolower($ext);
        $dest     = $dir . $fileName;

        try {
            $file->moveTo($dest);
        } catch (\Exception $e) {
            Log::error('GalleryUpload failed: ' . $e->getMessage());
            $this->Flash->error('Failed to save photo. Please try again.');
            return $this->redirect(['action' => 'index']);
        }

        $this->db()->execute(
            "INSERT INTO ssms_school_gallery (ssms_client_code, file_name, caption, uploaded_by)
             VALUES (?,?,?,?)",
            [$clientCode, $fileName, $caption ?: null, $userName]
        );

        $this->Flash->success('Photo uploaded successfully.');
        return $this->redirect(['action' => 'index']);
    }

    // ── delete: soft-delete ───────────────────────────────────────────────────
    public function delete(int $id): void
    {
        $this->request->allowMethod(['post']);
        $clientCode = $this->session()->read('ssms_client_code');

        if (!$this->isAdmin()) {
            $this->Flash->error('You do not have permission to delete photos.');
            return $this->redirect(['action' => 'index']);
        }

        $photo = $this->db()->execute(
            "SELECT * FROM ssms_school_gallery WHERE id = ? AND ssms_client_code = ? LIMIT 1",
            [$id, $clientCode]
        )->fetchAssoc();

        if ($photo) {
            $this->db()->execute(
                "UPDATE ssms_school_gallery SET status = 'deleted' WHERE id = ?",
                [$id]
            );
            // Optionally delete physical file
            $filePath = $this->galleryDir($clientCode) . $photo['file_name'];
            if (file_exists($filePath)) {
                @unlink($filePath);
            }
            $this->Flash->success('Photo deleted.');
        }

        return $this->redirect(['action' => 'index']);
    }
}
