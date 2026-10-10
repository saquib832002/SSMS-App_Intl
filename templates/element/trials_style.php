<?php /* Shared styles for the free-trial admin pages (included, not rendered alone). */ ?>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --brand:#1e40af; --bg:#f8fafc; --ok:#15803d; --warn:#b45309; --err:#b91c1c; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--ink); }
  .wrap { max-width:1100px; margin:0 auto; padding:24px 16px 48px; }
  a { color:var(--brand); text-decoration:none; } a:hover { text-decoration:underline; }
  h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:16px; margin:0 0 12px; }
  .sub { color:var(--muted); margin:0 0 20px; font-size:14px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:18px; margin-bottom:16px; }
  .msg { padding:12px 14px; border-radius:10px; margin-bottom:16px; font-size:14px; }
  .msg.ok { background:#dcfce7; color:var(--ok); } .msg.err { background:#fee2e2; color:var(--err); }
  label { font-size:13px; color:var(--muted); display:block; margin-bottom:4px; }
  input[type=number], input[type=date], input[type=text], select { border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:14px; }
  .btn { display:inline-block; border:0; border-radius:8px; padding:9px 16px; font-size:14px; font-weight:700; cursor:pointer; background:var(--brand); color:#fff; }
  .btn.ghost { background:#eff6ff; color:var(--brand); } .btn.danger { background:#fee2e2; color:var(--err); }
  .form-row { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; }
  .hint { font-size:12px; color:var(--muted); margin-top:6px; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th, td { text-align:left; padding:9px 8px; border-bottom:1px solid #f1f5f9; vertical-align:middle; }
  th { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; }
  .badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:12px; font-weight:700; }
  .b-trial { background:#e0e7ff; color:var(--brand); } .b-ended { background:#fee2e2; color:var(--err); }
  .b-paid { background:#dcfce7; color:var(--ok); } .b-warn { background:#fef3c7; color:var(--warn); }
  .tabs { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
  .tabs a { padding:6px 12px; border-radius:999px; background:#f1f5f9; color:#334155; font-size:13px; }
  .tabs a.on { background:var(--brand); color:#fff; }
  .grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:16px; }
  .kv { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f1f5f9; font-size:14px; }
  .kv span:first-child { color:var(--muted); }
  .scroll { overflow-x:auto; }
</style>
