/**
 * check-16kb.js
 * Run AFTER a Gradle build to find which .so files aren't 16 KB page-aligned.
 * Usage: node check-16kb.js
 */
const fs   = require('fs');
const path = require('path');

function checkElf(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 64) return null;
    if (buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) return null;

    const is64   = buf[4] === 2;
    const little = buf[5] === 1;
    const r16 = o => little ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
    const r32 = o => little ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
    const r64 = o => { const lo = r32(o), hi = r32(o+4); return hi * 0x100000000 + lo; };

    const e_phoff     = is64 ? Number(r64(32)) : r32(28);
    const e_phentsize = r16(is64 ? 54 : 42);
    const e_phnum     = r16(is64 ? 56 : 44);

    let minAlign = Infinity;
    for (let i = 0; i < e_phnum; i++) {
      const off = e_phoff + i * e_phentsize;
      if (off + e_phentsize > buf.length) break;
      if (r32(off) === 1 /* PT_LOAD */) {
        const align = is64 ? Number(r64(off + 48)) : r32(off + 28);
        if (align < minAlign) minAlign = align;
      }
    }
    return { is64, minAlign };
  } catch { return null; }
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try {
      if (fs.statSync(p).isDirectory()) walk(p, out);
      else if (f.endsWith('.so')) out.push(p);
    } catch {}
  }
}

const allSo = [];
[
  'android/app/build/intermediates/merged_native_libs',
  'android/app/build/intermediates/stripped_native_libs',
  'android/app/build/intermediates/native_libs',
].forEach(d => walk(d, allSo));

if (allSo.length === 0) {
  console.log('No .so files found. Run "gradlew bundleRelease" first, then re-run this script.');
  process.exit(0);
}

const results = allSo.map(p => ({ p, ...checkElf(p) })).filter(r => r.is64 !== undefined);
const bad  = results.filter(r => r.minAlign < 16384);
const good = results.filter(r => r.minAlign >= 16384);

console.log('\n=== 16 KB Page Size Alignment Check ===');
console.log(`Total .so files scanned : ${results.length}`);
console.log(`✓ Aligned (≥ 16 KB)     : ${good.length}`);
console.log(`✗ NOT aligned (< 16 KB) : ${bad.length}`);

if (bad.length === 0) {
  console.log('\nAll libraries are 16 KB aligned. The issue may be with packaging, not the libs.');
} else {
  console.log('\nProblematic libraries (report these):');
  const seen = new Set();
  for (const b of bad) {
    const bits  = b.is64 ? '64-bit' : '32-bit';
    const align = `align=0x${b.minAlign.toString(16).padStart(4,'0')}`;
    // Extract the package name from the path
    const match = b.p.match(/node_modules[/\\]((?:@[^/\\]+[/\\])?[^/\\]+)/);
    const pkg   = match ? match[1] : '(project native code)';
    const lib   = path.basename(b.p);
    const key   = `${bits}|${pkg}|${lib}`;
    if (!seen.has(key)) {
      seen.add(key);
      console.log(`  [${bits}] ${align}  lib: ${lib}  pkg: ${pkg}`);
    }
  }
  console.log('\nFix: update the listed packages to versions that ship 16 KB-aligned native libs.');
}
