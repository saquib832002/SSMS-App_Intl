<?php
/**
 * Controllers/SchoolGalleryApiController.php
 * School Memories photo gallery — upload, list, delete.
 *
 * ── SQL (run once) ────────────────────────────────────────────────────────────
 *   CREATE TABLE IF NOT EXISTS ssms_school_gallery (
 *     id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 *     ssms_client_code VARCHAR(50)   NOT NULL,
 *     file_name        VARCHAR(255)  NOT NULL,
 *     caption          VARCHAR(255)  DEFAULT NULL,
 *     uploaded_by      VARCHAR(100)  DEFAULT NULL,
 *     sort_order       INT           NOT NULL DEFAULT 0,
 *     created          DATETIME      DEFAULT CURRENT_TIMESTAMP,
 *     status           ENUM('active','deleted') NOT NULL DEFAULT 'active',
 *     INDEX idx_client_status (ssms_client_code, status, created)
 *   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 *
 * ── Per-client photo limit (run once) ─────────────────────────────────────────
 *   ALTER TABLE ssms_clients
 *     ADD COLUMN gallery_photo_limit INT NOT NULL DEFAULT 10;
 *
 *   -- To raise / lower the limit for a specific school:
 *   UPDATE ssms_clients SET gallery_photo_limit = 20 WHERE ssms_client_code = 'ABC';
 *
 * ── Routes (add inside JWT-protected scope in config/routes.php) ──────────────
 *   $builder->get( '/SchoolGalleryApi/getPhotos',   ['controller'=>'SchoolGalleryApi','action'=>'getPhotos']);
 *   $builder->post('/SchoolGalleryApi/uploadPhoto', ['controller'=>'SchoolGalleryApi','action'=>'uploadPhoto']);
 *   $builder->post('/SchoolGalleryApi/deletePhoto', ['controller'=>'SchoolGalleryApi','action'=>'deletePhoto']);
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Photos stored at: {htdocs}/clients/{clientCode}/gallery/{filename}
 */
declare(strict_types=1);

namespace App\Controller;

use Cake\Log\Log;

class SchoolGalleryApiController extends AppController
{
    private const ADMIN_ROLES    = ['admin', 'owner', 'super'];
    private const DEFAULT_LIMIT  = 10; // fallback if column not yet migrated

    // ── Request helpers ───────────────────────────────────────────────────────

    private function clientCode(): string
    {
        return (string)(
            $this->request->getAttribute('jwt_client_code')
            ?? $this->request->getHeaderLine('ssmsClientCode')
            ?? ''
        );
    }

    private function userRole(): string
    {
        return strtolower(trim(
            $this->request->getHeaderLine('ssmsUserRole') ?? ''
        ));
    }

    private function isAdmin(): bool
    {
        return in_array($this->userRole(), self::ADMIN_ROLES, true);
    }

    // ── Storage path ─────────────────────────────────────────────────────────

    private function galleryDir(string $clientCode): string
    {
        // Same relative-path convention as student/user photo uploads:
        // Controller lives in src/Controller/, so two levels up = htdocs root.
        return dirname(dirname(__DIR__)) . DS . 'clients' . DS . $clientCode . DS . 'gallery' . DS;
    }

    // ── Per-client photo limit ────────────────────────────────────────────────

    /**
     * Reads gallery_photo_limit from ssms_clients for this client.
     * Falls back to DEFAULT_LIMIT if the column hasn't been migrated yet.
     */
    private function photoLimit(string $clientCode): int
    {
        $db = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();
        try {
            $row = $db->execute(
                "SELECT gallery_photo_limit FROM ssms_clients WHERE ssms_client_code = ? LIMIT 1",
                [$clientCode]
            )->fetch('assoc');
            if (is_array($row) && isset($row['gallery_photo_limit'])) {
                return max(1, (int)$row['gallery_photo_limit']);
            }
        } catch (\Throwable $e) {
            // Column not yet added — use the default
            Log::warning('[Gallery] gallery_photo_limit column missing, using default: ' . $e->getMessage());
        }
        return self::DEFAULT_LIMIT;
    }

    // ── JSON response helper ─────────────────────────────────────────────────

    private function json(array $data, int $status = 200)
    {
        return $this->response
            ->withType('application/json')
            ->withStatus($status)
            ->withStringBody(json_encode($data));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /SchoolGalleryApi/getPhotos
    // Returns: { status, photos, total, limit }
    // ─────────────────────────────────────────────────────────────────────────
    public function getPhotos()
    {
        $this->request->allowMethod(['get']);
        $clientCode = $this->clientCode();
        $limit      = $this->photoLimit($clientCode);

        $db   = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();
        $rows = $db->execute(
            "SELECT id, file_name, caption, uploaded_by, created
             FROM ssms_school_gallery
             WHERE ssms_client_code = ? AND status = 'active'
             ORDER BY sort_order DESC, created DESC",
            [$clientCode]
        )->fetchAll('assoc');

        $photos = array_map(function ($r) {
            return [
                'id'         => (int)$r['id'],
                'fileName'   => $r['file_name'],
                'caption'    => $r['caption']    ?? '',
                'uploadedBy' => $r['uploaded_by'] ?? '',
                'created'    => $r['created']     ?? '',
            ];
        }, $rows ?: []);

        return $this->json([
            'status' => true,
            'photos' => $photos,
            'total'  => count($photos),
            'limit'  => $limit,
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /SchoolGalleryApi/uploadPhoto   (admin/owner only)
    // Enforces the per-client gallery_photo_limit before saving.
    // ─────────────────────────────────────────────────────────────────────────
    public function uploadPhoto()
    {
        $this->request->allowMethod(['post']);

        if (!$this->isAdmin()) {
            return $this->json(['status' => false, 'message' => 'Access denied.'], 403);
        }

        $clientCode = $this->clientCode();
        $db         = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();

        // ── Enforce per-client limit ──────────────────────────────────────────
        $limit = $this->photoLimit($clientCode);
        $count = (int)($db->execute(
            "SELECT COUNT(*) AS cnt FROM ssms_school_gallery
             WHERE ssms_client_code = ? AND status = 'active'",
            [$clientCode]
        )->fetch('assoc')['cnt'] ?? 0);

        if ($count >= $limit) {
            return $this->json([
                'status'  => false,
                'message' => "Photo limit reached ({$count}/{$limit}). Please delete older photos to upload new ones.",
                'total'   => $count,
                'limit'   => $limit,
            ], 422);
        }

        // ── Validate upload ───────────────────────────────────────────────────
        $userName = $this->request->getHeaderLine('ssmsUserName') ?: 'admin';
        $caption  = trim((string)($this->request->getData('caption') ?? ''));

        $file = $this->request->getUploadedFile('photo');
        if (!$file || $file->getError() !== UPLOAD_ERR_OK) {
            return $this->json(['status' => false, 'message' => 'No valid photo uploaded.'], 422);
        }

        $mime = $file->getClientMediaType();
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) {
            return $this->json(['status' => false, 'message' => 'Only JPEG, PNG, WebP, and GIF images are allowed.'], 422);
        }

        // ── Save file ─────────────────────────────────────────────────────────
        $ext      = pathinfo($file->getClientFilename(), PATHINFO_EXTENSION) ?: 'jpg';
        $fileName = date('YmdHis') . '_' . bin2hex(random_bytes(4)) . '.' . strtolower($ext);
        $dir      = $this->galleryDir($clientCode);

        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        try {
            $file->moveTo($dir . $fileName);
        } catch (\Throwable $e) {
            Log::error('[GalleryUpload] move failed: ' . $e->getMessage());
            return $this->json(['status' => false, 'message' => 'Failed to save photo.'], 500);
        }

        // ── Insert DB record ──────────────────────────────────────────────────
        $db->execute(
            "INSERT INTO ssms_school_gallery (ssms_client_code, file_name, caption, uploaded_by, created)
             VALUES (?, ?, ?, ?, NOW())",
            [$clientCode, $fileName, $caption ?: null, $userName]
        );
        $newId = (int)$db->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];

        return $this->json([
            'status'  => true,
            'message' => 'Photo uploaded successfully.',
            'total'   => $count + 1,
            'limit'   => $limit,
            'photo'   => [
                'id'       => $newId,
                'fileName' => $fileName,
                'caption'  => $caption,
            ],
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /SchoolGalleryApi/deletePhoto   (admin/owner only)
    // Body: { id: <int> }
    // ─────────────────────────────────────────────────────────────────────────
    public function deletePhoto()
    {
        $this->request->allowMethod(['post']);

        if (!$this->isAdmin()) {
            return $this->json(['status' => false, 'message' => 'Access denied.'], 403);
        }

        $clientCode = $this->clientCode();
        $photoId    = (int)($this->request->getData('id') ?? 0);

        if (!$photoId) {
            return $this->json(['status' => false, 'message' => 'Photo ID is required.'], 422);
        }

        $db  = $this->getTableLocator()->get('SsmsStudentEnrollment')->getConnection();
        $row = $db->execute(
            "SELECT file_name FROM ssms_school_gallery WHERE id = ? AND ssms_client_code = ? LIMIT 1",
            [$photoId, $clientCode]
        )->fetch('assoc');

        if (!is_array($row)) {
            return $this->json(['status' => false, 'message' => 'Photo not found.'], 404);
        }

        $db->execute(
            "UPDATE ssms_school_gallery SET status = 'deleted' WHERE id = ? AND ssms_client_code = ?",
            [$photoId, $clientCode]
        );

        $filePath = $this->galleryDir($clientCode) . $row['file_name'];
        if (file_exists($filePath)) {
            @unlink($filePath);
        }

        return $this->json(['status' => true, 'message' => 'Photo deleted.']);
    }
}
