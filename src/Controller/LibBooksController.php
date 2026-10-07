<?php
declare(strict_types=1);
namespace App\Controller;

use Cake\Datasource\ConnectionManager;

class LibBooksController extends AppController
{
    private function _db() { return ConnectionManager::get('default'); }

    private function _clientCode(): string
    {
        return (string)$this->request->getSession()->read('ssms_client_code');
    }

    private function _checkLibraryAccess(): bool
    {
        $session = $this->request->getSession();
        $role = $session->read('ssms_user_role');
        if (!$role) {
            $this->Flash->error('Please log in.');
            $this->redirect(['controller' => 'SaweraSsmsUsers', 'action' => 'login']);
            return false;
        }
        return true;
    }

    // ── GET /library/books ────────────────────────────────────────────────────
    public function index(): void
    {
        if (!$this->_checkLibraryAccess()) return;

        $db     = $this->_db();
        $client = $this->_clientCode();

        $search   = trim((string)$this->request->getQuery('q', ''));
        $category = (int)$this->request->getQuery('category', 0);
        $refOnly  = $this->request->getQuery('ref', '');

        $where   = ['b.ssms_client_code = ?'];
        $params  = [$client];

        if ($search !== '') {
            $where[]  = '(b.title LIKE ? OR b.isbn LIKE ? OR a.first_name LIKE ? OR a.last_name LIKE ?)';
            $params[] = "%{$search}%";
            $params[] = "%{$search}%";
            $params[] = "%{$search}%";
            $params[] = "%{$search}%";
        }
        if ($category > 0) {
            $where[]  = 'b.category_id = ?';
            $params[] = $category;
        }
        if ($refOnly === '1') {
            $where[] = 'b.is_reference = 1';
        } elseif ($refOnly === '0') {
            $where[] = 'b.is_reference = 0';
        }

        $sql = "
            SELECT b.*,
                   c.name AS category_name,
                   p.name AS publisher_name,
                   GROUP_CONCAT(CONCAT(a.first_name,' ',a.last_name) ORDER BY ba.author_order SEPARATOR ', ') AS authors
            FROM lib_books b
            LEFT JOIN lib_categories c  ON c.id = b.category_id
            LEFT JOIN lib_publishers p  ON p.id = b.publisher_id
            LEFT JOIN lib_book_authors ba ON ba.book_id = b.id
            LEFT JOIN lib_authors a      ON a.id = ba.author_id
            WHERE " . implode(' AND ', $where) . "
            GROUP BY b.id
            ORDER BY b.title ASC
        ";

        $books      = $db->execute($sql, $params)->fetchAll('assoc');
        $categories = $db->execute(
            "SELECT id, name FROM lib_categories WHERE ssms_client_code = ? ORDER BY name",
            [$client]
        )->fetchAll('assoc');

        // Dashboard stats
        $stats = $db->execute(
            "SELECT
               COUNT(*) AS total_books,
               SUM(total_copies) AS total_copies,
               SUM(available_copies) AS available_copies,
               SUM(IF(is_reference=1,1,0)) AS reference_books
             FROM lib_books WHERE ssms_client_code = ?",
            [$client]
        )->fetch('assoc');

        $this->set(compact('books', 'categories', 'search', 'category', 'refOnly', 'stats'));
    }

    // ── GET /library/books/view/{id} ─────────────────────────────────────────
    public function view(int $bookId = 0): void
    {
        if (!$this->_checkLibraryAccess()) return;

        $db     = $this->_db();
        $client = $this->_clientCode();

        $book = $db->execute(
            "SELECT b.*, c.name AS category_name, p.name AS publisher_name
             FROM lib_books b
             LEFT JOIN lib_categories c ON c.id = b.category_id
             LEFT JOIN lib_publishers p ON p.id = b.publisher_id
             WHERE b.id = ? AND b.ssms_client_code = ?",
            [$bookId, $client]
        )->fetch('assoc');

        if (!$book) {
            $this->Flash->error('Book not found.');
            $this->redirect(['action' => 'index']);
            return;
        }

        $authors = $db->execute(
            "SELECT a.first_name, a.last_name, ba.author_order
             FROM lib_book_authors ba
             JOIN lib_authors a ON a.id = ba.author_id
             WHERE ba.book_id = ? ORDER BY ba.author_order",
            [$bookId]
        )->fetchAll('assoc');

        $copies = $db->execute(
            "SELECT c.*,
                    co.member_id, co.due_date, co.issue_date,
                    m.full_name AS member_name, m.membership_no
             FROM lib_book_copies c
             LEFT JOIN lib_checkouts co ON co.copy_id = c.id AND co.status IN ('Active','Overdue')
             LEFT JOIN lib_members m ON m.id = co.member_id
             WHERE c.book_id = ? AND c.ssms_client_code = ?
             ORDER BY c.accession_no",
            [$bookId, $client]
        )->fetchAll('assoc');

        // Active reservations for this book
        $reservations = $db->execute(
            "SELECT r.*, m.full_name, m.membership_no
             FROM lib_reservations r
             JOIN lib_members m ON m.id = r.member_id
             WHERE r.book_id = ? AND r.ssms_client_code = ? AND r.status IN ('Waiting','Notified')
             ORDER BY r.queue_position",
            [$bookId, $client]
        )->fetchAll('assoc');

        $this->set(compact('book', 'authors', 'copies', 'reservations'));
    }

    // ── GET/POST /library/books/add ───────────────────────────────────────────
    public function add(): void
    {
        if (!$this->_checkLibraryAccess()) return;

        $db     = $this->_db();
        $client = $this->_clientCode();

        $categories = $db->execute(
            "SELECT id, name FROM lib_categories WHERE ssms_client_code = ? ORDER BY name",
            [$client]
        )->fetchAll('assoc');
        $publishers = $db->execute(
            "SELECT id, name FROM lib_publishers WHERE ssms_client_code = ? ORDER BY name",
            [$client]
        )->fetchAll('assoc');
        $authors = $db->execute(
            "SELECT id, CONCAT(first_name,' ',last_name) AS full_name
             FROM lib_authors WHERE ssms_client_code = ? ORDER BY last_name",
            [$client]
        )->fetchAll('assoc');

        $errors = [];
        $data   = [];

        if ($this->request->is('post')) {
            $validTypes = ['Textbook','Fiction','Non-Fiction','Reference','Periodical','Journal','E-Book','Other'];
            $data = [
                'ssms_client_code' => $client,
                'category_id'      => (int)$this->request->getData('category_id') ?: null,
                'publisher_id'     => (int)$this->request->getData('publisher_id') ?: null,
                'isbn'             => trim((string)$this->request->getData('isbn')),
                'title'            => trim((string)$this->request->getData('title')),
                'subtitle'         => trim((string)$this->request->getData('subtitle')),
                'edition'          => trim((string)$this->request->getData('edition')),
                'language'         => trim((string)$this->request->getData('language', 'English')),
                'pages'            => (int)$this->request->getData('pages') ?: null,
                'publication_year' => trim((string)$this->request->getData('publication_year')),
                'description'      => trim((string)$this->request->getData('description')),
                'subject_area'     => trim((string)$this->request->getData('subject_area')),
                'dewey_decimal'    => trim((string)$this->request->getData('dewey_decimal')),
                'book_type'        => in_array($this->request->getData('book_type'), $validTypes)
                                        ? $this->request->getData('book_type') : 'Other',
                'is_reference'     => (int)$this->request->getData('is_reference', 0),
            ];

            if ($data['title'] === '') $errors[] = 'Title is required.';

            if (empty($errors)) {
                $db->execute(
                    "INSERT INTO lib_books
                     (ssms_client_code,category_id,publisher_id,isbn,title,subtitle,edition,
                      language,pages,publication_year,description,subject_area,dewey_decimal,
                      book_type,is_reference)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    [
                        $data['ssms_client_code'], $data['category_id'], $data['publisher_id'],
                        $data['isbn'], $data['title'], $data['subtitle'], $data['edition'],
                        $data['language'], $data['pages'], $data['publication_year'] ?: null,
                        $data['description'], $data['subject_area'], $data['dewey_decimal'],
                        $data['book_type'], $data['is_reference']
                    ]
                );
                $bookId = (int)$db->execute("SELECT LAST_INSERT_ID() AS id")->fetch('assoc')['id'];

                // Save author links
                $authorIds = array_filter((array)$this->request->getData('author_ids', []));
                foreach ($authorIds as $order => $authorId) {
                    $db->execute(
                        "INSERT IGNORE INTO lib_book_authors (book_id, author_id, author_order) VALUES (?,?,?)",
                        [$bookId, (int)$authorId, $order + 1]
                    );
                }

                $this->Flash->success("Book '{$data['title']}' added to catalogue.");
                $this->redirect(['action' => 'copies', $bookId]);
                return;
            }
        }

        $this->set(compact('categories', 'publishers', 'authors', 'errors', 'data'));
    }

    // ── GET/POST /library/books/edit/{id} ────────────────────────────────────
    public function edit(int $bookId = 0): void
    {
        if (!$this->_checkLibraryAccess()) return;

        $db     = $this->_db();
        $client = $this->_clientCode();

        $book = $db->execute(
            "SELECT * FROM lib_books WHERE id = ? AND ssms_client_code = ?",
            [$bookId, $client]
        )->fetch('assoc');

        if (!$book) {
            $this->Flash->error('Book not found.');
            $this->redirect(['action' => 'index']);
            return;
        }

        $categories = $db->execute(
            "SELECT id, name FROM lib_categories WHERE ssms_client_code = ? ORDER BY name",
            [$client]
        )->fetchAll('assoc');
        $publishers = $db->execute(
            "SELECT id, name FROM lib_publishers WHERE ssms_client_code = ? ORDER BY name",
            [$client]
        )->fetchAll('assoc');
        $authors = $db->execute(
            "SELECT id, CONCAT(first_name,' ',last_name) AS full_name
             FROM lib_authors WHERE ssms_client_code = ? ORDER BY last_name",
            [$client]
        )->fetchAll('assoc');
        $currentAuthorIds = array_column(
            $db->execute(
                "SELECT author_id FROM lib_book_authors WHERE book_id = ? ORDER BY author_order",
                [$bookId]
            )->fetchAll('assoc'),
            'author_id'
        );

        $errors = [];

        if ($this->request->is('post')) {
            $title = trim((string)$this->request->getData('title'));
            if ($title === '') $errors[] = 'Title is required.';

            if (empty($errors)) {
                $db->execute(
                    "UPDATE lib_books SET
                       category_id=?, publisher_id=?, isbn=?, title=?, subtitle=?, edition=?,
                       language=?, pages=?, publication_year=?, description=?, subject_area=?,
                       dewey_decimal=?, is_reference=?
                     WHERE id = ? AND ssms_client_code = ?",
                    [
                        (int)$this->request->getData('category_id') ?: null,
                        (int)$this->request->getData('publisher_id') ?: null,
                        trim((string)$this->request->getData('isbn')),
                        $title,
                        trim((string)$this->request->getData('subtitle')),
                        trim((string)$this->request->getData('edition')),
                        trim((string)$this->request->getData('language', 'English')),
                        (int)$this->request->getData('pages') ?: null,
                        trim((string)$this->request->getData('publication_year')) ?: null,
                        trim((string)$this->request->getData('description')),
                        trim((string)$this->request->getData('subject_area')),
                        trim((string)$this->request->getData('dewey_decimal')),
                        (int)$this->request->getData('is_reference', 0),
                        $bookId, $client
                    ]
                );

                // Refresh authors
                $db->execute("DELETE FROM lib_book_authors WHERE book_id = ?", [$bookId]);
                $authorIds = array_filter((array)$this->request->getData('author_ids', []));
                foreach ($authorIds as $order => $authorId) {
                    $db->execute(
                        "INSERT INTO lib_book_authors (book_id, author_id, author_order) VALUES (?,?,?)",
                        [$bookId, (int)$authorId, $order + 1]
                    );
                }

                $this->Flash->success('Book updated.');
                $this->redirect(['action' => 'view', $bookId]);
                return;
            }
            $book = array_merge($book, $this->request->getData());
        }

        $this->set(compact('book', 'categories', 'publishers', 'authors', 'currentAuthorIds', 'errors'));
    }

    // ── GET/POST /library/books/copies/{bookId} ───────────────────────────────
    // Manage physical copies (accession numbers) for a book
    public function copies(int $bookId = 0): void
    {
        if (!$this->_checkLibraryAccess()) return;

        $db     = $this->_db();
        $client = $this->_clientCode();

        $book = $db->execute(
            "SELECT * FROM lib_books WHERE id = ? AND ssms_client_code = ?",
            [$bookId, $client]
        )->fetch('assoc');

        if (!$book) {
            $this->Flash->error('Book not found.');
            $this->redirect(['action' => 'index']);
            return;
        }

        $errors = [];

        if ($this->request->is('post')) {
            $action = $this->request->getData('_action', 'add_copy');

            if ($action === 'add_copy') {
                $accession = strtoupper(trim((string)$this->request->getData('accession_no')));
                $location  = trim((string)$this->request->getData('shelf_location'));
                $condition = $this->request->getData('condition_grade', 'Good');
                $price     = (float)$this->request->getData('purchase_price');
                $pdate     = trim((string)$this->request->getData('purchase_date'));

                if ($accession === '') {
                    $errors[] = 'Accession number is required.';
                } else {
                    // Check uniqueness
                    $exists = $db->execute(
                        "SELECT id FROM lib_book_copies WHERE ssms_client_code = ? AND accession_no = ?",
                        [$client, $accession]
                    )->fetch('assoc');

                    if ($exists) {
                        $errors[] = "Accession number '{$accession}' already exists.";
                    } else {
                        $db->execute(
                            "INSERT INTO lib_book_copies
                             (ssms_client_code, book_id, accession_no, condition_grade, shelf_location, purchase_price, purchase_date)
                             VALUES (?,?,?,?,?,?,?)",
                            [$client, $bookId, $accession, $condition, $location, $price ?: null, $pdate ?: null]
                        );
                        // Update counts
                        $db->execute(
                            "UPDATE lib_books
                             SET total_copies = total_copies + 1, available_copies = available_copies + 1
                             WHERE id = ?",
                            [$bookId]
                        );
                        $this->Flash->success("Copy '{$accession}' added.");
                    }
                }
            } elseif ($action === 'update_copy') {
                $copyId   = (int)$this->request->getData('copy_id');
                $location = trim((string)$this->request->getData('shelf_location'));
                $cond     = $this->request->getData('condition_grade', 'Good');
                $notes    = trim((string)$this->request->getData('notes'));

                $db->execute(
                    "UPDATE lib_book_copies SET condition_grade=?, shelf_location=?, notes=? WHERE id=? AND ssms_client_code=?",
                    [$cond, $location, $notes, $copyId, $client]
                );
                $this->Flash->success('Copy updated.');
            } elseif ($action === 'withdraw_copy') {
                $copyId = (int)$this->request->getData('copy_id');
                // Only withdraw Available copies
                $copy = $db->execute(
                    "SELECT status FROM lib_book_copies WHERE id=? AND ssms_client_code=?",
                    [$copyId, $client]
                )->fetch('assoc');

                if ($copy && $copy['status'] === 'Available') {
                    $db->execute(
                        "UPDATE lib_book_copies SET status='Withdrawn' WHERE id=? AND ssms_client_code=?",
                        [$copyId, $client]
                    );
                    $db->execute(
                        "UPDATE lib_books SET total_copies=total_copies-1, available_copies=available_copies-1 WHERE id=?",
                        [$bookId]
                    );
                    $this->Flash->success('Copy withdrawn from circulation.');
                } else {
                    $this->Flash->error('Only Available copies can be withdrawn.');
                }
            }

            // Refresh after POST
            if (empty($errors)) {
                $this->redirect(['action' => 'copies', $bookId]);
                return;
            }
        }

        $copies = $db->execute(
            "SELECT * FROM lib_book_copies WHERE book_id = ? AND ssms_client_code = ? ORDER BY accession_no",
            [$bookId, $client]
        )->fetchAll('assoc');

        $this->set(compact('book', 'copies', 'errors'));
    }

    // ── POST /library/books/delete/{id} ──────────────────────────────────────
    public function delete(int $bookId = 0): void
    {
        if (!$this->_checkLibraryAccess()) return;

        $db     = $this->_db();
        $client = $this->_clientCode();

        // Safety: don't delete if any copies are issued
        $issued = $db->execute(
            "SELECT COUNT(*) AS cnt FROM lib_checkouts co
             JOIN lib_book_copies bc ON bc.id = co.copy_id
             WHERE bc.book_id = ? AND bc.ssms_client_code = ? AND co.status IN ('Active','Overdue')",
            [$bookId, $client]
        )->fetch('assoc');

        if ((int)$issued['cnt'] > 0) {
            $this->Flash->error('Cannot delete: this book has copies currently issued.');
            $this->redirect(['action' => 'view', $bookId]);
            return;
        }

        $db->execute("DELETE FROM lib_book_authors WHERE book_id = ?", [$bookId]);
        $db->execute("DELETE FROM lib_book_copies WHERE book_id = ? AND ssms_client_code = ?", [$bookId, $client]);
        $db->execute("DELETE FROM lib_books WHERE id = ? AND ssms_client_code = ?", [$bookId, $client]);

        $this->Flash->success('Book deleted from catalogue.');
        $this->redirect(['action' => 'index']);
    }

    // ── GET /library/categories ───────────────────────────────────────────────
    public function categories(): void
    {
        if (!$this->_checkLibraryAccess()) return;

        $db     = $this->_db();
        $client = $this->_clientCode();

        $errors = [];

        if ($this->request->is('post')) {
            $action = $this->request->getData('_action', 'add');
            if ($action === 'add') {
                $name = trim((string)$this->request->getData('name'));
                $desc = trim((string)$this->request->getData('description'));
                if ($name === '') {
                    $errors[] = 'Category name is required.';
                } else {
                    $db->execute(
                        "INSERT INTO lib_categories (ssms_client_code, name, description) VALUES (?,?,?)",
                        [$client, $name, $desc]
                    );
                    $this->Flash->success("Category '{$name}' added.");
                    $this->redirect(['action' => 'categories']);
                    return;
                }
            } elseif ($action === 'delete') {
                $catId = (int)$this->request->getData('category_id');
                $db->execute(
                    "DELETE FROM lib_categories WHERE id = ? AND ssms_client_code = ?",
                    [$catId, $client]
                );
                $this->Flash->success('Category deleted.');
                $this->redirect(['action' => 'categories']);
                return;
            }
        }

        $categories = $db->execute(
            "SELECT c.*, COUNT(b.id) AS book_count
             FROM lib_categories c
             LEFT JOIN lib_books b ON b.category_id = c.id AND b.ssms_client_code = c.ssms_client_code
             WHERE c.ssms_client_code = ?
             GROUP BY c.id
             ORDER BY c.name",
            [$client]
        )->fetchAll('assoc');

        $this->set(compact('categories', 'errors'));
    }

    // ── GET /library/authors ──────────────────────────────────────────────────
    public function authors(): void
    {
        if (!$this->_checkLibraryAccess()) return;

        $db     = $this->_db();
        $client = $this->_clientCode();

        $errors = [];

        if ($this->request->is('post')) {
            $action = $this->request->getData('_action', 'add');
            if ($action === 'add') {
                $first = trim((string)$this->request->getData('first_name'));
                $last  = trim((string)$this->request->getData('last_name'));
                if ($first === '' || $last === '') {
                    $errors[] = 'First and last name are required.';
                } else {
                    $db->execute(
                        "INSERT INTO lib_authors (ssms_client_code, first_name, last_name) VALUES (?,?,?)",
                        [$client, $first, $last]
                    );
                    $this->Flash->success("Author added.");
                    $this->redirect(['action' => 'authors']);
                    return;
                }
            } elseif ($action === 'delete') {
                $authorId = (int)$this->request->getData('author_id');
                $db->execute("DELETE FROM lib_book_authors WHERE author_id = ?", [$authorId]);
                $db->execute(
                    "DELETE FROM lib_authors WHERE id = ? AND ssms_client_code = ?",
                    [$authorId, $client]
                );
                $this->Flash->success('Author deleted.');
                $this->redirect(['action' => 'authors']);
                return;
            }
        }

        $authors = $db->execute(
            "SELECT a.*, COUNT(ba.book_id) AS book_count
             FROM lib_authors a
             LEFT JOIN lib_book_authors ba ON ba.author_id = a.id
             WHERE a.ssms_client_code = ?
             GROUP BY a.id
             ORDER BY a.last_name, a.first_name",
            [$client]
        )->fetchAll('assoc');

        $q = trim((string)$this->request->getQuery('q', ''));
        if ($q !== '') {
            $authors = array_filter($authors, fn($a) =>
                stripos($a['first_name'] . ' ' . $a['last_name'], $q) !== false
            );
        }

        $this->set(compact('authors', 'errors', 'q'));
    }

    // ── GET /library/publishers ───────────────────────────────────────────────
    public function publishers(): void
    {
        if (!$this->_checkLibraryAccess()) return;

        $db     = $this->_db();
        $client = $this->_clientCode();
        $errors  = [];
        $success = '';

        if ($this->request->is('post')) {
            $action = $this->request->getData('_action', 'add');

            if ($action === 'add') {
                $name    = trim((string)$this->request->getData('name'));
                $country = trim((string)$this->request->getData('country'));
                $website = trim((string)$this->request->getData('website'));
                if ($name === '') {
                    $errors[] = 'Publisher name is required.';
                } else {
                    $db->execute(
                        "INSERT INTO lib_publishers (ssms_client_code, name, country, website) VALUES (?,?,?,?)",
                        [$client, $name, $country, $website]
                    );
                    $success = "Publisher '{$name}' added.";
                }
            } elseif ($action === 'edit') {
                $pubId   = (int)$this->request->getData('publisher_id');
                $name    = trim((string)$this->request->getData('name'));
                $country = trim((string)$this->request->getData('country'));
                $website = trim((string)$this->request->getData('website'));
                if ($name === '') {
                    $errors[] = 'Publisher name is required.';
                } else {
                    $db->execute(
                        "UPDATE lib_publishers SET name=?, country=?, website=? WHERE id=? AND ssms_client_code=?",
                        [$name, $country, $website, $pubId, $client]
                    );
                    $success = 'Publisher updated.';
                    $this->redirect(['action' => 'publishers']);
                    return;
                }
            } elseif ($action === 'delete') {
                $pubId = (int)$this->request->getData('publisher_id');
                $db->execute(
                    "DELETE FROM lib_publishers WHERE id=? AND ssms_client_code=?",
                    [$pubId, $client]
                );
                $success = 'Publisher deleted.';
                $this->redirect(['action' => 'publishers']);
                return;
            }
        }

        $q = trim((string)$this->request->getQuery('q', ''));

        $sql = "SELECT p.*, COUNT(b.id) AS book_count
                FROM lib_publishers p
                LEFT JOIN lib_books b ON b.publisher_id = p.id AND b.ssms_client_code = p.ssms_client_code
                WHERE p.ssms_client_code = ?";
        $params = [$client];
        if ($q !== '') {
            $sql .= " AND p.name LIKE ?";
            $params[] = '%' . $q . '%';
        }
        $sql .= " GROUP BY p.id ORDER BY p.name";
        $publishers = $db->execute($sql, $params)->fetchAll('assoc');

        // For inline edit pre-fill
        $editPub = null;
        $editId  = (int)$this->request->getQuery('edit', 0);
        if ($editId > 0) {
            foreach ($publishers as $p) {
                if ((int)$p['id'] === $editId) { $editPub = $p; break; }
            }
        }

        $this->set(compact('publishers', 'errors', 'success', 'q', 'editPub'));
    }
}
