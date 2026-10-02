<?php
/**
 * ChapterApiController.php — DEPRECATED
 *
 * Chapter endpoints have been merged into TestSeriesApiController.php to keep the
 * API surface lean.  All four routes now live under /TestSeriesApi/:
 *
 *   GET    /TestSeriesApi/getChapters?class_id=&subject_id=
 *   POST   /TestSeriesApi/createChapter
 *   POST   /TestSeriesApi/updateChapter/:id
 *   DELETE /TestSeriesApi/deleteChapter/:id
 *
 * Update your routes.php accordingly and delete this file once deployed.
 */
