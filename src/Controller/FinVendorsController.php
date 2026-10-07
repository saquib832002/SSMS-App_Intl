<?php
declare(strict_types=1);
namespace App\Controller;

use Cake\Datasource\ConnectionManager;

class FinVendorsController extends AppController
{
    private function db() { return ConnectionManager::get('default'); }
    private function code(): string { return (string)$this->request->getSession()->read('ssms_client_code'); }
    private function user(): string { return (string)$this->request->getSession()->read('ssms_sawera_id'); }

    private function nextVendorCode(): string
    {
        $last = $this->db()->execute(
            "SELECT vendor_code FROM fin_vendors WHERE ssms_client_code=? ORDER BY vendor_id DESC LIMIT 1",
            [$this->code()]
        )->fetch('assoc');
        if ($last && preg_match('/VND-(\d+)/', $last['vendor_code'], $m)) {
            return 'VND-' . str_pad((string)((int)$m[1] + 1), 4, '0', STR_PAD_LEFT);
        }
        return 'VND-0001';
    }

    public function index()
    {
        $status   = $this->request->getQuery('status') ?? 'active';
        $search   = $this->request->getQuery('q') ?? '';
        $category = $this->request->getQuery('category') ?? '';

        $where  = "WHERE v.ssms_client_code=?";
        $params = [$this->code()];

        if ($status !== 'all') { $where .= " AND v.status=?"; $params[] = $status; }
        if ($search) { $where .= " AND (v.vendor_name LIKE ? OR v.vendor_code LIKE ? OR v.gst_number LIKE ?)"; $params[] = "%$search%"; $params[] = "%$search%"; $params[] = "%$search%"; }
        if ($category) { $where .= " AND v.category=?"; $params[] = $category; }

        $vendors = $this->db()->execute(
            "SELECT v.*,
                    (SELECT COUNT(*) FROM fin_purchase_orders po WHERE po.vendor_id=v.vendor_id) AS po_count,
                    (SELECT COALESCE(SUM(vi.net_payable - vi.amount_paid),0) FROM fin_vendor_invoices vi WHERE vi.vendor_id=v.vendor_id AND vi.payment_status!='paid') AS outstanding
             FROM fin_vendors v $where ORDER BY v.vendor_name ASC",
            $params
        )->fetchAll('assoc');

        $this->set(compact('vendors', 'status', 'search', 'category'));
    }

    public function add()
    {
        if ($this->request->is('post')) {
            $d = $this->request->getData();
            $this->db()->execute(
                "INSERT INTO fin_vendors
                 (ssms_client_code,vendor_code,vendor_name,contact_person,email,phone,address,
                  city,state,pincode,gst_number,pan_number,payment_terms,
                  bank_account_no,bank_ifsc,bank_name,tds_applicable,tds_rate,
                  category,status,notes,created_by)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [
                    $this->code(), $this->nextVendorCode(), $d['vendor_name'],
                    $d['contact_person'] ?? null, $d['email'] ?? null, $d['phone'] ?? null,
                    $d['address'] ?? null, $d['city'] ?? null, $d['state'] ?? null, $d['pincode'] ?? null,
                    $d['gst_number'] ?? null, $d['pan_number'] ?? null,
                    (int)($d['payment_terms'] ?? 30),
                    $d['bank_account_no'] ?? null, $d['bank_ifsc'] ?? null, $d['bank_name'] ?? null,
                    !empty($d['tds_applicable']) ? 1 : 0,
                    (float)($d['tds_rate'] ?? 0),
                    $d['category'] ?? null, $d['status'] ?? 'active',
                    $d['notes'] ?? null, $this->user()
                ]
            );
            $this->Flash->success('Vendor added successfully.');
            return $this->redirect(['action' => 'index']);
        }
    }

    public function edit(int $id)
    {
        $vendor = $this->db()->execute(
            "SELECT * FROM fin_vendors WHERE vendor_id=? AND ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$vendor) { $this->Flash->error('Vendor not found.'); return $this->redirect(['action' => 'index']); }

        if ($this->request->is(['post', 'put'])) {
            $d = $this->request->getData();
            if ($d['status'] === 'blacklisted' && empty($d['blacklist_reason'])) {
                $this->Flash->error('Please provide a reason for blacklisting.');
            } else {
                $this->db()->execute(
                    "UPDATE fin_vendors SET vendor_name=?,contact_person=?,email=?,phone=?,address=?,
                     city=?,state=?,pincode=?,gst_number=?,pan_number=?,payment_terms=?,
                     bank_account_no=?,bank_ifsc=?,bank_name=?,tds_applicable=?,tds_rate=?,
                     category=?,status=?,blacklist_reason=?,notes=?,modified=NOW()
                     WHERE vendor_id=? AND ssms_client_code=?",
                    [
                        $d['vendor_name'], $d['contact_person'] ?? null, $d['email'] ?? null, $d['phone'] ?? null,
                        $d['address'] ?? null, $d['city'] ?? null, $d['state'] ?? null, $d['pincode'] ?? null,
                        $d['gst_number'] ?? null, $d['pan_number'] ?? null,
                        (int)($d['payment_terms'] ?? 30),
                        $d['bank_account_no'] ?? null, $d['bank_ifsc'] ?? null, $d['bank_name'] ?? null,
                        !empty($d['tds_applicable']) ? 1 : 0, (float)($d['tds_rate'] ?? 0),
                        $d['category'] ?? null, $d['status'] ?? 'active',
                        $d['blacklist_reason'] ?? null,
                        $d['notes'] ?? null, $id, $this->code()
                    ]
                );
                $this->Flash->success('Vendor updated.');
                return $this->redirect(['action' => 'index']);
            }
        }
        $this->set(compact('vendor'));
    }

    public function view(int $id)
    {
        $vendor = $this->db()->execute(
            "SELECT * FROM fin_vendors WHERE vendor_id=? AND ssms_client_code=?",
            [$id, $this->code()]
        )->fetch('assoc');
        if (!$vendor) { $this->Flash->error('Vendor not found.'); return $this->redirect(['action' => 'index']); }

        $orders = $this->db()->execute(
            "SELECT * FROM fin_purchase_orders WHERE vendor_id=? AND ssms_client_code=? ORDER BY po_date DESC LIMIT 10",
            [$id, $this->code()]
        )->fetchAll('assoc');

        $invoices = $this->db()->execute(
            "SELECT * FROM fin_vendor_invoices WHERE vendor_id=? AND ssms_client_code=? ORDER BY invoice_date DESC LIMIT 10",
            [$id, $this->code()]
        )->fetchAll('assoc');

        $outstanding = array_sum(array_map(fn($i) => $i['net_payable'] - $i['amount_paid'], $invoices));

        $this->set(compact('vendor', 'orders', 'invoices', 'outstanding'));
    }
}
