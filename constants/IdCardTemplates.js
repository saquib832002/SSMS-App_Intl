/**
 * constants/IdCardTemplates.js
 *
 * 11 ID-card template definitions for StudentIdCardV2Screen.
 * Nothing here modifies the existing StudentIdCardScreen.
 *
 * Exports:
 *   ID_CARD_TEMPLATES_V2   – metadata array (id, name, orientation, …)
 *   ID_CARD_V2_DEFAULTS    – default field-visibility config
 *   CARD_LABELS_V2         – label translations (en / hi / ur)
 *   buildPdfHtml_V2()      – assembles a full A4 HTML document for expo-print
 */

// ─── Template registry ────────────────────────────────────────────────────────
export const ID_CARD_TEMPLATES_V2 = [
  { id: 'classic_horizontal', name: 'Classic Horizontal', orientation: 'landscape', cardsPerPage: 3, defaultPrimary: '#0c4a6e', defaultAccent: '#be185d', description: 'Solid header · photo left · details right' },
  { id: 'vertical_portrait',  name: 'Vertical Portrait',  orientation: 'portrait',  cardsPerPage: 4, defaultPrimary: '#5b21b6', defaultAccent: '#9333ea', description: 'Portrait card · centred photo overlapping header' },
  { id: 'left_spine',         name: 'Left Colour Spine',  orientation: 'landscape', cardsPerPage: 3, defaultPrimary: '#065f46', defaultAccent: '#0369a1', description: 'Full-height colour column left · details right' },
  { id: 'diagonal_split',     name: 'Diagonal Split',     orientation: 'landscape', cardsPerPage: 3, defaultPrimary: '#991b1b', defaultAccent: '#78350f', description: 'Diagonal boundary · colour top-left · white bottom-right' },
  { id: 'top_banner',         name: 'Top Photo Banner',   orientation: 'landscape', cardsPerPage: 3, defaultPrimary: '#0c4a6e', defaultAccent: '#0284c7', description: 'Wide header + tagline · square photo left · details right' },
  { id: 'wave_arc',           name: 'Wave Arc',           orientation: 'landscape', cardsPerPage: 3, defaultPrimary: '#1d4ed8', defaultAccent: '#1e40af', description: 'Arch-curved header · circular photo centred on wave' },
  { id: 'diagonal_slash',     name: 'Diagonal Slash',     orientation: 'landscape', cardsPerPage: 3, defaultPrimary: '#5b21b6', defaultAccent: '#7c3aed', description: 'Two-tone diagonal polygon left · details right' },
  { id: 'corner_fan',         name: 'Corner Fan',         orientation: 'landscape', cardsPerPage: 3, defaultPrimary: '#14532d', defaultAccent: '#15803d', description: 'Three-tone graduated fan from top · white triangle for details' },
  { id: 'portrait_wave',      name: 'Portrait Wave',      orientation: 'portrait',  cardsPerPage: 4, defaultPrimary: '#92400e', defaultAccent: '#b45309', description: 'Vertical card · arc header · circular photo centred on arc' },
  { id: 'ribbon_header',      name: 'Ribbon Header',      orientation: 'landscape', cardsPerPage: 3, defaultPrimary: '#c2410c', defaultAccent: '#ea580c', description: 'Three diagonal colour bands · portrait photo left' },
  { id: 'badge_portrait',     name: 'Badge Portrait',     orientation: 'portrait',  cardsPerPage: 4, defaultPrimary: '#1a2469', defaultAccent: '#f5c400', description: 'Navy header · yellow school name · red ID badge · ruled detail box · multi-language' },
];

// ─── Default field-visibility config ─────────────────────────────────────────
export const ID_CARD_V2_DEFAULTS = {
  showSchoolLogo:        true,
  showSchoolAddress:     true,
  showTagline:           false,
  taglineText:           'LEARN · GROW · SUCCEED',
  showStudentPhoto:      true,
  showAdmissionNo:       true,
  showBloodGroup:        true,
  showFatherName:        true,
  showMotherName:        false,
  showDateOfBirth:       true,
  showGender:            false,
  showParentPhone:       true,
  showStudentAddress:    false,
  showPrincipalSignature:true,
  showValidUpto:         true,
  showEstdYear:          false,
  estdYear:              '2020',
  ifFoundText:           'If found, please return to school',
  showIfFound:           false,
  cardLanguage:          'en',
  cardTemplateV2:        'wave_arc',
  cardPrimaryV2:         '#1d4ed8',
  cardAccentV2:          '#1e40af',
};

// ─── Label translations ───────────────────────────────────────────────────────
export const CARD_LABELS_V2 = {
  en: { admNo:'Adm. No.', father:"Father's Name", mother:"Mother's Name", dob:'Date of Birth', gender:'Gender', bloodGroup:'Blood Group', classGrade:'Class / Grade', enrollRoll:'Enr / Roll No.', parentContact:'Parent Contact', address:'Address', estd:'ESTD.', principal:'Principal', contact:'Contact', validUpto:'Valid Upto', ifFound:'If Found Return To', fullName:'Full Name', mobile:'Mobile No.', idCard:'Student Identity Card', className:'Class', session:'Session', busRoute:'Bus Route' },
  hi: { admNo:'प्रवेश सं.', father:'पिता का नाम', mother:'माता का नाम', dob:'जन्म तिथि', gender:'लिंग', bloodGroup:'रक्त समूह', classGrade:'कक्षा / ग्रेड', enrollRoll:'नामांकन सं.', parentContact:'अभिभावक संपर्क', address:'पता', estd:'स्थापित', principal:'प्राचार्य', contact:'संपर्क', validUpto:'वैध तक', ifFound:'वापस करें', fullName:'विद्यार्थी का पूरा नाम', mobile:'मोबाइल नंबर', idCard:'विद्यार्थी पहचान-पत्र', className:'कक्षा', session:'सत्र', busRoute:'बस मार्ग' },
  ur:  { admNo:'داخلہ نمبر', father:'والد کا نام', mother:'والدہ کا نام', dob:'تاریخ پیدائش', gender:'جنس', bloodGroup:'بلڈ گروپ', classGrade:'جماعت / گریڈ', enrollRoll:'رول نمبر', parentContact:'والدین رابطہ', address:'پتہ', estd:'قیام', principal:'پرنسپل', contact:'رابطہ', validUpto:'درستگی تک', ifFound:'واپس کریں', fullName:'مکمل نام', mobile:'موبائل نمبر', idCard:'طالب علم شناختی کارڈ', className:'جماعت', session:'سیشن', busRoute:'بس روٹ' },
};

// ─── Shared HTML helpers ──────────────────────────────────────────────────────
const fmtDob = (raw) => {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d)) return raw;
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getUTCDate()).padStart(2,'0')} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const photoBox = (photoUrl, w, h, radius = '0', border = '#fff') => {
  const st = `width:${w};height:${h};border-radius:${radius};overflow:hidden;border:1.5px solid ${border};flex-shrink:0;background:#dde3ec;`;
  return photoUrl
    ? `<div style="${st}"><img src="${photoUrl}" style="width:100%;height:100%;object-fit:cover;display:block;" alt=""/></div>`
    : `<div style="${st};display:flex;align-items:center;justify-content:center;"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5"><circle cx="12" cy="7" r="5"/><path d="M3 21c0-5 4-9 9-9s9 4 9 9"/></svg></div>`;
};

const logoBox = (logoUrl, schoolName, size, radius = '50%', border = '#fff') => {
  if (logoUrl) return `<img src="${logoUrl}" style="width:${size};height:${size};border-radius:${radius};border:1.5px solid ${border};object-fit:cover;flex-shrink:0;" alt="logo"/>`;
  const init = (schoolName || 'S')[0].toUpperCase();
  return `<div style="width:${size};height:${size};border-radius:${radius};border:1.5px solid ${border};background:rgba(255,255,255,0.22);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:#fff;flex-shrink:0;">${init}</div>`;
};

const dRow = (label, value) => value
  ? `<div style="display:flex;align-items:flex-start;border-bottom:1px dotted #e2e8f0;"><span style="font-size:6.5px;font-weight:700;color:#64748b;width:62px;flex-shrink:0;line-height:9.5px;">${label}</span><span style="font-size:7.5px;font-weight:800;color:#0f172a;flex:1;line-height:9.5px;overflow:hidden;">${value}</span></div>`
  : '';

const sigHtml = (sigUrl, label) => sigUrl
  ? `<div><img src="${sigUrl}" style="height:14px;max-width:56px;object-fit:contain;display:block;"/><div style="font-size:5.5px;font-weight:700;color:#475569;text-align:center;">${label}</div></div>`
  : `<div><div style="width:52px;border-bottom:1px solid #94a3b8;margin-bottom:2px;"></div><div style="font-size:5.5px;font-weight:700;color:#475569;text-align:center;">${label}</div></div>`;

// ─── Shared footer — two stacked lines + principal sig on the right ───────────
// Line 1 (top):    phone icon + school phone number  [C.showSchoolPhone !== false]
// Line 2 (bottom): "If found…" small text            [C.showIfFound / showIfFoundBar]
// Right side:      principal signature               [C.showPrincipalSignature]
// extraStyle: pass 'position:absolute;bottom:0;left:0;right:0;' for abs-positioned templates
const sharedFooter = (primary, accent, phone, C, L, school, extraStyle = '') => {
  const isRTL     = L.idCard && /[؀-ۿ]/.test(L.idCard);
  const dir       = isRTL ? 'rtl' : 'ltr';
  const showPhone = phone && C.showSchoolPhone !== false;
  const showFound = (C.showIfFound || C.showIfFoundBar) && (C.ifFoundText || 'If found, please return to school');

  const phoneRow = showPhone ? `
    <div style="display:flex;align-items:center;gap:1.2mm;margin-bottom:${showFound ? '0.7mm' : '0'};">
      <div style="width:12px;height:12px;border-radius:50%;border:1.5px solid ${accent};display:flex;align-items:center;justify-content:center;flex-shrink:0;background:rgba(255,255,255,0.08);">
        <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="${accent}" stroke-width="2.8"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8 19.79 19.79 0 01.02 2.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z"/></svg>
      </div>
      <span style="color:${accent};font-size:6px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:ltr;">${L.contact||'Contact'} : ${phone}</span>
    </div>` : '';

  const foundRow = showFound ? `
    <div style="color:rgba(255,255,255,0.60);font-size:3px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${C.ifFoundText||'If found, please return to school'}</div>` : '';

  const sig = C.showPrincipalSignature ? `<div style="flex-shrink:0;margin-left:1.5mm;width:11mm;overflow:hidden;">${sigHtml(school.sigUrl, L.principal||'Principal')}</div>` : '';

  return `<div style="background:${primary};padding:1.5mm 2mm;flex-shrink:0;display:flex;align-items:flex-start;direction:${dir};${extraStyle}">
    <div style="flex:1;overflow:hidden;">${phoneRow}${foundRow}</div>
    ${sig}
  </div>`;
};

// ─── Template 1: Classic Horizontal ──────────────────────────────────────────
function buildHtml_classic_horizontal(s, school, colors, cfg, L) {
  const { primary, accent } = colors; const C = cfg;
  const classStr = [s.className, s.section].filter(Boolean).join(' / ');
  const name = [s.firstName, s.lastName].filter(Boolean).join(' ');
  const phone = school.phone || '';
  return `
<div style="width:85.6mm;height:54mm;border-radius:2.5mm;overflow:hidden;border:1px solid rgba(0,0,0,0.12);font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column;background:#fff;">
  <div style="background:${primary};padding:2mm 3mm;display:flex;align-items:center;gap:2mm;flex-shrink:0;">
    ${C.showSchoolLogo ? logoBox(school.logoUrl, school.name, '10mm') : ''}
    <div style="flex:1;overflow:hidden;">
      <div style="color:#fff;font-size:8px;font-weight:900;letter-spacing:.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${(school.name||'').toUpperCase()}</div>
      ${C.showSchoolAddress && school.address ? `<div style="color:rgba(255,255,255,0.75);font-size:6px;line-height:1.3;overflow:hidden;">${school.address}</div>` : ''}
      ${C.showTagline ? `<div style="color:rgba(255,255,255,0.6);font-size:5.5px;letter-spacing:1px;">${C.taglineText||'LEARN · GROW · SUCCEED'}</div>` : ''}
    </div>
  </div>
  <div style="flex:1;display:flex;overflow:hidden;">
    <div style="width:28mm;flex-shrink:0;background:#eef2f7;display:flex;flex-direction:column;align-items:center;padding:1.5mm 1mm;gap:1mm;">
      ${C.showStudentPhoto ? photoBox(s.photoUrl, '22mm', '22mm', '1mm', primary) : ''}
      ${C.showAdmissionNo && s.admissionNumber ? `<div style="font-size:6px;color:#475569;text-align:center;">${L.admNo}: <b>${s.admissionNumber}</b></div>` : ''}
      <div style="font-size:6.5px;color:${primary};font-weight:900;text-align:center;">${classStr}</div>
      ${C.showBloodGroup && s.bloodGroup ? `<div style="background:${accent};color:#fff;font-size:6px;font-weight:700;padding:0.5mm 2mm;border-radius:2mm;">🩸 ${s.bloodGroup}</div>` : ''}
    </div>
    <div style="flex:1;padding:1.5mm 2mm;overflow:hidden;">
      <div style="font-size:9px;font-weight:900;color:${primary};margin-bottom:1mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name.toUpperCase()}</div>
      ${C.showFatherName   ? dRow(L.father, s.fatherName) : ''}
      ${C.showMotherName   ? dRow(L.mother, s.motherName) : ''}
      ${C.showDateOfBirth  ? dRow(L.dob, fmtDob(s.dob)) : ''}
      ${C.showGender       ? dRow(L.gender, s.gender) : ''}
      ${C.showParentPhone  ? dRow(L.parentContact, s.parentPhone||s.fatherPhone||s.motherPhone) : ''}
      ${C.showStudentAddress ? dRow(L.address, s.address) : ''}
    </div>
  </div>
  ${sharedFooter(primary, accent, phone, C, L, school)}
</div>`;
}

// ─── Template 2: Vertical Portrait ───────────────────────────────────────────
function buildHtml_vertical_portrait(s, school, colors, cfg, L) {
  const { primary, accent } = colors; const C = cfg;
  const classStr = [s.className, s.section].filter(Boolean).join(' / ');
  const name = [s.firstName, s.lastName].filter(Boolean).join(' ');
  const phone = school.phone || '';
  return `
<div style="width:54mm;height:85.6mm;border-radius:2.5mm;overflow:hidden;border:1px solid rgba(0,0,0,0.12);font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column;background:#fff;">
  <div style="background:${primary};padding:1.5mm 2mm;display:flex;align-items:center;gap:1.5mm;flex-shrink:0;">
    ${C.showSchoolLogo ? logoBox(school.logoUrl, school.name, '8mm') : ''}
    <div style="text-align:left;overflow:hidden;flex:1;">
      <div style="color:#fff;font-size:7.5px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${(school.name||'').toUpperCase()}</div>
      ${C.showSchoolAddress && school.address ? `<div style="color:rgba(255,255,255,0.75);font-size:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${school.address}</div>` : ''}
      ${C.showTagline ? `<div style="color:rgba(255,255,255,0.65);font-size:5px;letter-spacing:.8px;">${C.taglineText||'LEARN · GROW · SUCCEED'}</div>` : ''}
    </div>
  </div>
  <div style="padding:3mm 0 1.5mm;display:flex;flex-direction:column;align-items:center;gap:1mm;flex-shrink:0;">
    ${C.showStudentPhoto ? photoBox(s.photoUrl,'20mm','20mm','50%',primary) : ''}
    <div style="text-align:center;">
      <div style="font-size:8.5px;font-weight:900;color:${primary};">${name.toUpperCase()}</div>
      <div style="font-size:6.5px;color:#475569;font-weight:700;">${classStr}</div>
      ${C.showAdmissionNo && s.admissionNumber ? `<div style="font-size:6px;color:#64748b;">${L.admNo}: ${s.admissionNumber}</div>` : ''}
    </div>
  </div>
  <div style="flex:1;padding:0.5mm 2.5mm;overflow:hidden;">
    ${C.showFatherName  ? dRow(L.father, s.fatherName) : ''}
    ${C.showMotherName  ? dRow(L.mother, s.motherName) : ''}
    ${C.showDateOfBirth ? dRow(L.dob, fmtDob(s.dob)) : ''}
    ${C.showGender      ? dRow(L.gender, s.gender) : ''}
    ${C.showBloodGroup && s.bloodGroup ? dRow(L.bloodGroup, s.bloodGroup) : ''}
    ${C.showParentPhone ? dRow(L.parentContact, s.parentPhone||s.fatherPhone||s.motherPhone) : ''}
    ${C.showStudentAddress ? dRow(L.address, s.address) : ''}
  </div>
  ${sharedFooter(primary, accent, phone, C, L, school)}
</div>`;
}

// ─── Template 3: Left Colour Spine ───────────────────────────────────────────
// Restructured: row content in flex:1 wrapper, footer spans full width below
function buildHtml_left_spine(s, school, colors, cfg, L) {
  const { primary, accent } = colors; const C = cfg;
  const classStr = [s.className, s.section].filter(Boolean).join(' / ');
  const name = [s.firstName, s.lastName].filter(Boolean).join(' ');
  const phone = school.phone || '';
  return `
<div style="width:85.6mm;height:54mm;border-radius:2.5mm;overflow:hidden;border:1px solid rgba(0,0,0,0.12);font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column;background:#fff;">
  <div style="flex:1;display:flex;overflow:hidden;">
    <div style="width:22mm;background:${primary};flex-shrink:0;display:flex;flex-direction:column;align-items:center;padding:1.5mm 1mm;gap:1.5mm;">
      ${C.showSchoolLogo ? logoBox(school.logoUrl, school.name, '10mm') : ''}
      ${C.showStudentPhoto ? photoBox(s.photoUrl, '16mm', '16mm', '1mm', 'rgba(255,255,255,0.5)') : ''}
      ${C.showBloodGroup && s.bloodGroup ? `<div style="background:${accent};color:#fff;font-size:5.5px;font-weight:700;padding:0.4mm 1.5mm;border-radius:2mm;text-align:center;">🩸${s.bloodGroup}</div>` : ''}
      ${C.showAdmissionNo && s.admissionNumber ? `<div style="color:rgba(255,255,255,0.8);font-size:5px;text-align:center;line-height:1.3;">${L.admNo}<br/><b style="font-size:6px;">${s.admissionNumber}</b></div>` : ''}
    </div>
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
      <div style="background:${accent};padding:1.5mm 2mm;flex-shrink:0;">
        <div style="color:#fff;font-size:8px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${(school.name||'').toUpperCase()}</div>
        ${C.showSchoolAddress && school.address ? `<div style="color:rgba(255,255,255,0.8);font-size:5.5px;">${school.address}</div>` : ''}
      </div>
      <div style="flex:1;padding:1mm 2mm;overflow:hidden;">
        <div style="font-size:9px;font-weight:900;color:${primary};margin-bottom:0.5mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name.toUpperCase()}</div>
        <div style="font-size:6.5px;color:${accent};font-weight:700;margin-bottom:1mm;">${classStr}</div>
        ${C.showFatherName  ? dRow(L.father, s.fatherName) : ''}
        ${C.showDateOfBirth ? dRow(L.dob, fmtDob(s.dob)) : ''}
        ${C.showParentPhone ? dRow(L.parentContact, s.parentPhone||s.fatherPhone||s.motherPhone) : ''}
        ${C.showStudentAddress ? dRow(L.address, s.address) : ''}
      </div>
    </div>
  </div>
  ${sharedFooter(primary, accent, phone, C, L, school)}
</div>`;
}

// ─── Template 4: Diagonal Split ──────────────────────────────────────────────
// Inner abs content raised to bottom:7mm; footer added as separate abs strip
function buildHtml_diagonal_split(s, school, colors, cfg, L) {
  const { primary, accent } = colors; const C = cfg;
  const classStr = [s.className, s.section].filter(Boolean).join(' / ');
  const name = [s.firstName, s.lastName].filter(Boolean).join(' ');
  const phone = school.phone || '';
  return `
<div style="width:85.6mm;height:54mm;border-radius:2.5mm;overflow:hidden;border:1px solid rgba(0,0,0,0.12);font-family:Arial,Helvetica,sans-serif;position:relative;background:#fff;">
  <svg style="position:absolute;top:0;left:0;width:100%;height:100%;" preserveAspectRatio="none" viewBox="0 0 323 204">
    <polygon points="0,0 148,0 82,204 0,204" fill="${primary}"/>
    <polygon points="0,0 118,0 64,204 0,204" fill="${accent}" opacity="0.85"/>
  </svg>
  <div style="position:absolute;top:0;left:0;right:0;bottom:7mm;display:flex;">
    <div style="width:48%;display:flex;flex-direction:column;padding:2mm 1mm 2mm 2.5mm;gap:1.5mm;">
      ${C.showSchoolLogo ? logoBox(school.logoUrl, school.name, '10mm') : ''}
      <div style="color:#fff;font-size:7px;font-weight:900;line-height:1.3;overflow:hidden;">${(school.name||'').toUpperCase()}</div>
      ${C.showTagline ? `<div style="color:rgba(255,255,255,0.65);font-size:5px;letter-spacing:.8px;">${C.taglineText||''}</div>` : ''}
      ${C.showStudentPhoto ? photoBox(s.photoUrl,'14mm','14mm','50%','rgba(255,255,255,0.7)') : ''}
    </div>
    <div style="flex:1;display:flex;flex-direction:column;padding:2mm 2mm 1.5mm 1.5mm;overflow:hidden;">
      <div style="font-size:8.5px;font-weight:900;color:${primary};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name.toUpperCase()}</div>
      <div style="font-size:6px;color:${accent};font-weight:700;margin-bottom:0.5mm;">${classStr}</div>
      ${C.showAdmissionNo && s.admissionNumber ? dRow(L.admNo, s.admissionNumber) : ''}
      ${C.showFatherName  ? dRow(L.father, s.fatherName) : ''}
      ${C.showDateOfBirth ? dRow(L.dob, fmtDob(s.dob)) : ''}
      ${C.showBloodGroup && s.bloodGroup ? dRow(L.bloodGroup, s.bloodGroup) : ''}
      ${C.showParentPhone ? dRow(L.parentContact, s.parentPhone||s.fatherPhone||s.motherPhone) : ''}
      ${C.showStudentAddress ? dRow(L.address, s.address) : ''}
    </div>
  </div>
  ${sharedFooter(primary, accent, phone, C, L, school, 'position:absolute;bottom:0;left:0;right:0;')}
</div>`;
}

// ─── Template 5: Top Photo Banner ────────────────────────────────────────────
function buildHtml_top_banner(s, school, colors, cfg, L) {
  const { primary, accent } = colors; const C = cfg;
  const classStr = [s.className, s.section].filter(Boolean).join(' / ');
  const name = [s.firstName, s.lastName].filter(Boolean).join(' ');
  const phone = school.phone || '';
  return `
<div style="width:85.6mm;height:54mm;border-radius:2.5mm;overflow:hidden;border:1px solid rgba(0,0,0,0.12);font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column;background:#fff;">
  <div style="background:${primary};padding:1.5mm 2.5mm;display:flex;align-items:center;gap:2mm;flex-shrink:0;">
    ${C.showSchoolLogo ? logoBox(school.logoUrl, school.name, '9mm') : ''}
    <div style="flex:1;overflow:hidden;">
      <div style="color:#fff;font-size:8px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${(school.name||'').toUpperCase()}</div>
      ${C.showSchoolAddress && school.address ? `<div style="color:rgba(255,255,255,0.75);font-size:5.5px;">${school.address}</div>` : ''}
      ${C.showTagline ? `<div style="color:rgba(255,255,255,0.6);font-size:5px;letter-spacing:1px;">${C.taglineText||'LEARN · GROW · SUCCEED'}</div>` : ''}
    </div>
  </div>
  <div style="background:${accent};height:1mm;flex-shrink:0;"></div>
  <div style="flex:1;display:flex;overflow:hidden;">
    <div style="width:24mm;flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1mm;gap:0.8mm;background:#f8fafc;border-right:1px solid #e2e8f0;">
      ${C.showStudentPhoto ? photoBox(s.photoUrl,'20mm','20mm','1mm',primary) : ''}
      ${C.showBloodGroup && s.bloodGroup ? `<div style="background:${accent};color:#fff;font-size:5.5px;font-weight:700;padding:0.3mm 1.5mm;border-radius:2mm;">🩸 ${s.bloodGroup}</div>` : ''}
    </div>
    <div style="flex:1;padding:1.5mm 2mm;overflow:hidden;">
      <div style="font-size:8.5px;font-weight:900;color:${primary};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name.toUpperCase()}</div>
      <div style="font-size:6.5px;color:${accent};font-weight:700;margin-bottom:0.5mm;">${classStr}${C.showAdmissionNo && s.admissionNumber ? ' · '+s.admissionNumber : ''}</div>
      ${C.showFatherName   ? dRow(L.father, s.fatherName) : ''}
      ${C.showMotherName   ? dRow(L.mother, s.motherName) : ''}
      ${C.showDateOfBirth  ? dRow(L.dob, fmtDob(s.dob)) : ''}
      ${C.showParentPhone  ? dRow(L.parentContact, s.parentPhone||s.fatherPhone||s.motherPhone) : ''}
      ${C.showStudentAddress ? dRow(L.address, s.address) : ''}
    </div>
  </div>
  ${sharedFooter(primary, accent, phone, C, L, school)}
</div>`;
}

// ─── Template 6: Wave Arc ─────────────────────────────────────────────────────
function buildHtml_wave_arc(s, school, colors, cfg, L) {
  const { primary, accent } = colors; const C = cfg;
  const classStr = [s.className, s.section].filter(Boolean).join(' / ');
  const name = [s.firstName, s.lastName].filter(Boolean).join(' ');
  const phone = school.phone || '';
  return `
<div style="width:85.6mm;height:54mm;border-radius:2.5mm;overflow:hidden;border:1px solid rgba(0,0,0,0.12);font-family:Arial,Helvetica,sans-serif;background:#fff;position:relative;">
  <svg style="position:absolute;top:0;left:0;width:100%;height:100%;" preserveAspectRatio="none" viewBox="0 0 323 204">
    <path d="M0,0 L323,0 L323,90 Q161,130 0,90 Z" fill="${primary}"/>
  </svg>
  <div style="position:absolute;top:0;left:0;right:0;padding:2mm 2.5mm;display:flex;align-items:center;gap:1.5mm;">
    ${C.showSchoolLogo ? logoBox(school.logoUrl, school.name, '9mm') : ''}
    <div style="flex:1;overflow:hidden;">
      <div style="color:#fff;font-size:7.5px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${(school.name||'').toUpperCase()}</div>
      ${C.showSchoolAddress && school.address ? `<div style="color:rgba(255,255,255,0.75);font-size:5.5px;">${school.address}</div>` : ''}
    </div>
    ${C.showAdmissionNo && s.admissionNumber ? `<div style="color:rgba(255,255,255,0.85);font-size:5.5px;text-align:right;">${L.admNo}<br/><b>${s.admissionNumber}</b></div>` : ''}
  </div>
  <div style="position:absolute;top:8mm;left:50%;transform:translateX(-50%);">
    ${C.showStudentPhoto ? photoBox(s.photoUrl,'13mm','13mm','50%',primary) : ''}
  </div>
  <div style="position:absolute;top:23mm;left:0;right:0;bottom:7mm;overflow:hidden;padding:0 2mm;">
    <div style="text-align:center;font-size:8px;font-weight:900;color:${primary};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name.toUpperCase()}</div>
    <div style="text-align:center;font-size:5.5px;color:${accent};font-weight:700;margin-bottom:0.5mm;">${classStr}${C.showBloodGroup && s.bloodGroup ? ' · 🩸 '+s.bloodGroup : ''}</div>
    ${C.showAdmissionNo && s.admissionNumber ? dRow(L.admNo, s.admissionNumber) : ''}
    ${C.showFatherName  ? dRow(L.father, s.fatherName) : ''}
    ${C.showMotherName  ? dRow(L.mother, s.motherName) : ''}
    ${C.showDateOfBirth ? dRow(L.dob, fmtDob(s.dob)) : ''}
    ${C.showGender      ? dRow(L.gender, s.gender) : ''}
    ${C.showParentPhone ? dRow(L.parentContact, s.parentPhone||s.fatherPhone||s.motherPhone) : ''}
    ${C.showStudentAddress ? dRow(L.address, s.address) : ''}
  </div>
  ${sharedFooter(primary, accent, phone, C, L, school, 'position:absolute;bottom:0;left:0;right:0;')}
</div>`;
}

// ─── Template 7: Diagonal Slash ──────────────────────────────────────────────
function buildHtml_diagonal_slash(s, school, colors, cfg, L) {
  const { primary, accent } = colors; const C = cfg;
  const classStr = [s.className, s.section].filter(Boolean).join(' / ');
  const name = [s.firstName, s.lastName].filter(Boolean).join(' ');
  const phone = school.phone || '';
  return `
<div style="width:85.6mm;height:54mm;border-radius:2.5mm;overflow:hidden;border:1px solid rgba(0,0,0,0.12);font-family:Arial,Helvetica,sans-serif;position:relative;background:#fff;">
  <svg style="position:absolute;top:0;left:0;width:100%;height:100%;" preserveAspectRatio="none" viewBox="0 0 323 204">
    <polygon points="0,0 138,0 80,204 0,204" fill="${primary}"/>
    <polygon points="0,0 108,0 60,204 0,204" fill="${accent}" opacity="0.85"/>
  </svg>
  <div style="position:absolute;top:0;left:0;right:0;bottom:7mm;display:flex;">
    <div style="width:45%;display:flex;flex-direction:column;align-items:center;padding:2mm 0 2mm 2mm;gap:1.5mm;">
      ${C.showSchoolLogo ? logoBox(school.logoUrl, school.name, '9mm') : ''}
      <div style="color:#fff;font-size:6.5px;font-weight:900;text-align:center;padding:0 1mm;overflow:hidden;">${(school.name||'').toUpperCase()}</div>
      ${C.showStudentPhoto ? photoBox(s.photoUrl,'14mm','14mm','50%','rgba(255,255,255,0.7)') : ''}
    </div>
    <div style="flex:1;display:flex;flex-direction:column;padding:1.5mm 2mm 1.5mm 2mm;overflow:hidden;">
      <div style="font-size:8px;font-weight:900;color:${primary};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name.toUpperCase()}</div>
      <div style="font-size:6px;color:${accent};font-weight:700;margin-bottom:0.5mm;">${classStr}</div>
      ${C.showAdmissionNo && s.admissionNumber ? dRow(L.admNo, s.admissionNumber) : ''}
      ${C.showFatherName  ? dRow(L.father, s.fatherName) : ''}
      ${C.showDateOfBirth ? dRow(L.dob, fmtDob(s.dob)) : ''}
      ${C.showBloodGroup && s.bloodGroup ? dRow(L.bloodGroup, s.bloodGroup) : ''}
      ${C.showParentPhone ? dRow(L.parentContact, s.parentPhone||s.fatherPhone||s.motherPhone) : ''}
      ${C.showStudentAddress ? dRow(L.address, s.address) : ''}
    </div>
  </div>
  ${sharedFooter(primary, accent, phone, C, L, school, 'position:absolute;bottom:0;left:0;right:0;')}
</div>`;
}

// ─── Template 8: Corner Fan ───────────────────────────────────────────────────
// Data section raised to bottom:7mm; footer added as separate abs strip
function buildHtml_corner_fan(s, school, colors, cfg, L) {
  const { primary, accent } = colors; const C = cfg;
  const classStr = [s.className, s.section].filter(Boolean).join(' / ');
  const name = [s.firstName, s.lastName].filter(Boolean).join(' ');
  const light = accent + 'aa';
  const phone = school.phone || '';
  return `
<div style="width:85.6mm;height:54mm;border-radius:2.5mm;overflow:hidden;border:1px solid rgba(0,0,0,0.12);font-family:Arial,Helvetica,sans-serif;position:relative;background:#fff;">
  <svg style="position:absolute;top:0;left:0;width:100%;height:100%;" preserveAspectRatio="none" viewBox="0 0 323 204">
    <polygon points="0,0 323,0 323,126 0,204" fill="${primary}"/>
    <polygon points="0,0 323,0 323,88 0,152" fill="${accent}"/>
    <polygon points="0,0 323,0 323,50 0,96" fill="${light}"/>
    <polygon points="0,96 323,50 323,204 0,204" fill="#fff"/>
  </svg>
  <div style="position:absolute;top:1.5mm;left:1.5mm;display:flex;align-items:center;gap:1mm;">
    ${C.showSchoolLogo ? logoBox(school.logoUrl, school.name, '9mm') : ''}
    <div style="color:#fff;font-size:7px;font-weight:900;max-width:40mm;overflow:hidden;">${(school.name||'').toUpperCase()}</div>
  </div>
  ${C.showStudentPhoto ? `<div style="position:absolute;top:6mm;left:2mm;">${photoBox(s.photoUrl,'16mm','16mm','50%','rgba(255,255,255,0.75)')}</div>` : ''}
  <div style="position:absolute;top:4mm;right:2mm;text-align:right;">
    ${C.showAdmissionNo && s.admissionNumber ? `<div style="color:rgba(255,255,255,0.9);font-size:6px;">${L.admNo}: <b>${s.admissionNumber}</b></div>` : ''}
    ${C.showBloodGroup && s.bloodGroup ? `<div style="color:rgba(255,255,255,0.9);font-size:6px;">🩸 ${s.bloodGroup}</div>` : ''}
  </div>
  <div style="position:absolute;bottom:22mm;left:21mm;right:0;padding:0 2mm;">
    <div style="font-size:8px;font-weight:900;color:rgba(255,255,255,0.95);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name.toUpperCase()}</div>
    <div style="font-size:6px;color:rgba(255,255,255,0.8);font-weight:700;">${classStr}</div>
  </div>
  <div style="position:absolute;bottom:7mm;left:0;right:0;max-height:15mm;overflow:hidden;display:flex;">
    <div style="width:38%;padding:1mm 1.5mm;display:flex;flex-direction:column;gap:0.3mm;">
      ${C.showFatherName ? dRow(L.father, s.fatherName) : ''}
      ${C.showDateOfBirth ? dRow(L.dob, fmtDob(s.dob)) : ''}
    </div>
    <div style="flex:1;padding:1mm 2mm 1mm 0;display:flex;flex-direction:column;gap:0.3mm;">
      ${C.showParentPhone ? dRow(L.parentContact, s.parentPhone||s.fatherPhone||s.motherPhone) : ''}
      ${C.showStudentAddress ? dRow(L.address, s.address) : ''}
    </div>
  </div>
  ${sharedFooter(primary, accent, phone, C, L, school, 'position:absolute;bottom:0;left:0;right:0;')}
</div>`;
}

// ─── Template 9: Portrait Wave ────────────────────────────────────────────────
function buildHtml_portrait_wave(s, school, colors, cfg, L) {
  const { primary, accent } = colors; const C = cfg;
  const classStr = [s.className, s.section].filter(Boolean).join(' / ');
  const name = [s.firstName, s.lastName].filter(Boolean).join(' ');
  const phone = school.phone || '';
  return `
<div style="width:54mm;height:85.6mm;border-radius:2.5mm;overflow:hidden;border:1px solid rgba(0,0,0,0.12);font-family:Arial,Helvetica,sans-serif;background:#fff;position:relative;">
  <svg style="position:absolute;top:0;left:0;width:100%;height:40%;" preserveAspectRatio="none" viewBox="0 0 204 100">
    <path d="M0,0 L204,0 L204,68 Q102,90 0,68 Z" fill="${primary}"/>
  </svg>
  <div style="position:absolute;top:1.5mm;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:0.8mm;">
    ${C.showSchoolLogo ? logoBox(school.logoUrl, school.name, '8mm') : ''}
    <div style="color:#fff;font-size:7px;font-weight:900;text-align:center;padding:0 2mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:50mm;">${(school.name||'').toUpperCase()}</div>
    ${C.showTagline ? `<div style="color:rgba(255,255,255,0.65);font-size:5px;letter-spacing:.8px;">${C.taglineText||''}</div>` : ''}
  </div>
  <div style="position:absolute;top:13mm;left:50%;transform:translateX(-50%);">
    ${C.showStudentPhoto ? photoBox(s.photoUrl,'17mm','17mm','50%',primary) : ''}
  </div>
  <div style="position:absolute;top:33mm;left:0;right:0;bottom:7mm;overflow:hidden;padding:0 2.5mm;">
    <div style="text-align:center;font-size:8px;font-weight:900;color:${primary};">${name.toUpperCase()}</div>
    <div style="text-align:center;font-size:6px;color:${accent};font-weight:700;margin-bottom:1mm;">${classStr}</div>
    ${C.showAdmissionNo && s.admissionNumber ? dRow(L.admNo, s.admissionNumber) : ''}
    ${C.showFatherName  ? dRow(L.father, s.fatherName) : ''}
    ${C.showDateOfBirth ? dRow(L.dob, fmtDob(s.dob)) : ''}
    ${C.showBloodGroup && s.bloodGroup ? dRow(L.bloodGroup, s.bloodGroup) : ''}
    ${C.showParentPhone ? dRow(L.parentContact, s.parentPhone||s.fatherPhone||s.motherPhone) : ''}
    ${C.showStudentAddress ? dRow(L.address, s.address) : ''}
  </div>
  ${sharedFooter(primary, accent, phone, C, L, school, 'position:absolute;bottom:0;left:0;right:0;')}
</div>`;
}

// ─── Template 10: Ribbon Header ───────────────────────────────────────────────
function buildHtml_ribbon_header(s, school, colors, cfg, L) {
  const { primary, accent } = colors; const C = cfg;
  const classStr = [s.className, s.section].filter(Boolean).join(' / ');
  const name = [s.firstName, s.lastName].filter(Boolean).join(' ');
  const light = accent + 'cc';
  const phone = school.phone || '';
  return `
<div style="width:85.6mm;height:54mm;border-radius:2.5mm;overflow:hidden;border:1px solid rgba(0,0,0,0.12);font-family:Arial,Helvetica,sans-serif;position:relative;background:#fff;">
  <svg style="position:absolute;top:0;left:0;width:100%;height:100%;" preserveAspectRatio="none" viewBox="0 0 323 204">
    <polygon points="0,0 323,0 323,46 0,64" fill="${primary}"/>
    <polygon points="0,0 323,0 323,32 0,44" fill="${accent}"/>
    <polygon points="0,0 323,0 323,18 0,26" fill="${light}"/>
  </svg>
  <div style="position:absolute;top:1.5mm;left:2mm;right:2mm;display:flex;align-items:center;gap:1.5mm;">
    ${C.showSchoolLogo ? logoBox(school.logoUrl, school.name, '8mm') : ''}
    <div style="flex:1;overflow:hidden;">
      <div style="color:#fff;font-size:7.5px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${(school.name||'').toUpperCase()}</div>
      ${C.showSchoolAddress && school.address ? `<div style="color:rgba(255,255,255,0.75);font-size:5.5px;">${school.address}</div>` : ''}
    </div>
  </div>
  <div style="position:absolute;top:14mm;left:2mm;bottom:10mm;width:22mm;">
    ${C.showStudentPhoto ? photoBox(s.photoUrl,'22mm','26mm','1mm',primary) : ''}
  </div>
  <div style="position:absolute;top:14mm;left:27mm;right:2mm;bottom:8mm;overflow:hidden;">
    <div style="font-size:8px;font-weight:900;color:${primary};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name.toUpperCase()}</div>
    <div style="font-size:6px;color:${accent};font-weight:700;margin-bottom:0.5mm;">${classStr}${C.showAdmissionNo && s.admissionNumber ? ' · '+s.admissionNumber : ''}</div>
    ${C.showFatherName   ? dRow(L.father, s.fatherName) : ''}
    ${C.showDateOfBirth  ? dRow(L.dob, fmtDob(s.dob)) : ''}
    ${C.showBloodGroup && s.bloodGroup ? dRow(L.bloodGroup, s.bloodGroup) : ''}
    ${C.showParentPhone  ? dRow(L.parentContact, s.parentPhone||s.fatherPhone||s.motherPhone) : ''}
    ${C.showStudentAddress ? dRow(L.address, s.address) : ''}
  </div>
  ${sharedFooter(primary, accent, phone, C, L, school, 'position:absolute;bottom:0;left:0;right:0;')}
</div>`;
}

// ─── Template 11: Badge Portrait (Hindi / Urdu / English) ────────────────────
function buildHtml_badge_portrait(s, school, colors, cfg, L) {
  const { primary, accent } = colors; const C = cfg;
  const classStr = [s.className, s.section].filter(Boolean).join(' / ');
  const name = [s.firstName, s.lastName].filter(Boolean).join(' ');
  const phone = school.phone || '';
  const isRTL = L.idCard && /[؀-ۿ]/.test(L.idCard); // Urdu
  const dir = isRTL ? 'rtl' : 'ltr';

  // Fixed-width label column — skips the row entirely when value is blank
  const dLine = (label, value) => {
    if (!value && value !== 0) return '';
    return `
    <div style="display:flex;align-items:flex-end;margin-bottom:0.65mm;direction:${dir};">
      <span style="width:15.5mm;min-width:15.5mm;font-size:5px;font-weight:700;color:${primary};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:7.5px;flex-shrink:0;">${label} :</span>
      <span style="flex:1;border-bottom:0.8px solid ${primary};font-size:5.5px;font-weight:600;color:#0f172a;min-height:7.5px;line-height:7.5px;overflow:hidden;padding-bottom:0.3px;">${value}</span>
    </div>`;
  };

  return `
<div style="width:54mm;height:85.6mm;border-radius:2mm;overflow:hidden;border:1.5px solid ${primary};font-family:'Noto Sans','Arial',Helvetica,sans-serif;display:flex;flex-direction:column;background:#e8f4ff;position:relative;">
  <!-- HEADER — background is card colour; SVG draws the navy region bounded by the arcs -->
  <div style="background:#e8f4ff;padding:2mm 2.5mm 1.5mm;text-align:center;position:relative;flex-shrink:0;overflow:hidden;">
    <svg style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;" viewBox="0 0 204 88" preserveAspectRatio="none">
      <!-- Navy filled region: full top, narrows at bottom along the two arcs -->
      <path d="M0,0 L204,0 L204,34 Q206,66 153,88 L51,88 Q-2,66 0,34 Z" fill="${primary}"/>
      <!-- Decorative arc bands over the navy fill -->
      <path d="M-25,34 Q-2,66 51,96"  fill="none" stroke="rgba(210,240,255,0.65)" stroke-width="7"   stroke-linecap="butt"/>
      <path d="M-18,40 Q-1,71 51,96"  fill="none" stroke="rgba(150,210,255,0.55)" stroke-width="4.5" stroke-linecap="butt"/>
      <path d="M-12,46 Q 0,76 51,96"  fill="none" stroke="rgba(80,175,245,0.42)"  stroke-width="2.5" stroke-linecap="butt"/>
      <path d="M -6,52 Q 0,81 51,96"  fill="none" stroke="rgba(255,220,80,0.38)"  stroke-width="1.4" stroke-linecap="butt"/>
      <path d="M229,34 Q206,66 153,96" fill="none" stroke="rgba(210,240,255,0.65)" stroke-width="7"   stroke-linecap="butt"/>
      <path d="M222,40 Q205,71 153,96" fill="none" stroke="rgba(150,210,255,0.55)" stroke-width="4.5" stroke-linecap="butt"/>
      <path d="M216,46 Q204,76 153,96" fill="none" stroke="rgba(80,175,245,0.42)"  stroke-width="2.5" stroke-linecap="butt"/>
      <path d="M210,52 Q204,81 153,96" fill="none" stroke="rgba(255,220,80,0.38)"  stroke-width="1.4" stroke-linecap="butt"/>
    </svg>
    <!-- School name -->
    <div style="color:${accent};font-size:10px;font-weight:900;line-height:1.35;position:relative;direction:${dir};text-shadow:0 1px 3px rgba(0,0,0,0.4);">${school.name || ''}</div>
    <!-- Tagline -->
    ${C.showTagline ? `<div style="color:rgba(255,255,255,0.70);font-size:5.5px;letter-spacing:0.8px;position:relative;margin-top:0.5mm;">${C.taglineText||'LEARN · GROW · SUCCEED'}</div>` : ''}
    <!-- Address pill -->
    ${C.showSchoolAddress && school.address
      ? `<div style="background:${accent};color:${primary};font-size:5.8px;font-weight:800;border-radius:8px;padding:0.7mm 2.5mm;margin-top:1.2mm;display:inline-block;position:relative;direction:${dir};">${school.address}</div>`
      : ''}
  </div>
  <!-- ID CARD BADGE label -->
  <div style="background:#cc1122;color:#fff;border-radius:2mm;margin:0.8mm 2.5mm 0.5mm;text-align:center;font-size:7.5px;font-weight:900;padding:0.7mm 1.5mm;flex-shrink:0;letter-spacing:0.2px;direction:${dir};">${L.idCard || 'Student Identity Card'}</div>
  <!-- Logo + Photo row — kept small to maximise details area -->
  <div style="display:flex;justify-content:space-between;align-items:center;padding:0.3mm 2.5mm 0.5mm;flex-shrink:0;">
    ${C.showSchoolLogo ? logoBox(school.logoUrl, school.name, '13mm', '50%', accent) : '<div style="width:13mm;"></div>'}
    ${C.showStudentPhoto ? photoBox(s.photoUrl, '14mm', '15mm', '1mm', '#2563eb') : ''}
  </div>
  <!-- Details box -->
  <div style="border:1.2px solid #6ea8d8;border-radius:1.5mm;margin:0.3mm 1.2mm;padding:1mm 1.5mm 0.8mm;flex:1;overflow:hidden;background:#fff;">
    ${dLine(L.fullName || 'Full Name', name)}
    ${C.showAdmissionNo ? dLine(L.admNo, s.admissionNumber) : ''}
    ${dLine(L.className || 'Class', classStr)}
    ${C.showDateOfBirth  ? dLine(L.dob, fmtDob(s.dob)) : ''}
    ${C.showGender       ? dLine(L.gender, s.gender) : ''}
    ${C.showFatherName    ? dLine(L.father,   s.fatherName) : ''}
    ${C.showMotherName    ? dLine(L.mother,   s.motherName) : ''}
    ${C.showBloodGroup && s.bloodGroup ? dLine(L.bloodGroup, s.bloodGroup) : ''}
    ${C.showParentPhone   ? dLine(L.mobile || L.parentContact, s.parentPhone || s.fatherPhone || s.motherPhone) : ''}
    ${C.showSessionYear   ? dLine(L.session  || 'Session',   s.sessionYear || s.sessionName || '') : ''}
    ${C.showBusRoute && (s.busRoute || s.busName) ? dLine(L.busRoute || 'Bus Route', s.busRoute || s.busName) : ''}
    ${C.showStudentAddress ? dLine(L.address, s.address) : ''}
    ${(C.showValidUpto || C.showValidityYear) && s.validUpto ? dLine(L.validUpto, s.validUpto) : ''}
  </div>
  <!-- Footer: corner arcs use card-bg colour to create concave cutouts at the top corners -->
  ${sharedFooter(primary, accent, phone, C, L, school)}
</div>`;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────
const BUILDERS = {
  classic_horizontal: buildHtml_classic_horizontal,
  vertical_portrait:  buildHtml_vertical_portrait,
  left_spine:         buildHtml_left_spine,
  diagonal_split:     buildHtml_diagonal_split,
  top_banner:         buildHtml_top_banner,
  wave_arc:           buildHtml_wave_arc,
  diagonal_slash:     buildHtml_diagonal_slash,
  corner_fan:         buildHtml_corner_fan,
  portrait_wave:      buildHtml_portrait_wave,
  ribbon_header:      buildHtml_ribbon_header,
  badge_portrait:     buildHtml_badge_portrait,
};

export function buildOneCardHtml_V2(templateId, student, school, colors, cfg, HOST_NAME) {
  const fn = BUILDERS[templateId];
  if (!fn) return '';
  const L = CARD_LABELS_V2[cfg.cardLanguage] ?? CARD_LABELS_V2.en;
  const s = {
    ...student,
    photoUrl: student.photo
      ? `${HOST_NAME}/clients/${student.ssmsClientCode}/Students/${student.registrationNo}/${student.photo}`
      : null,
  };
  const schoolWithUrls = {
    ...school,
    logoUrl: school.logoUrl
      ? `${HOST_NAME}/clients/${school.ssmsClientCode}/${school.logoUrl}`
      : null,
    sigUrl: school.principalSignature
      ? `${HOST_NAME}/clients/${school.ssmsClientCode}/${school.principalSignature}`
      : null,
  };
  return fn(s, schoolWithUrls, colors, cfg, L);
}

// ─── Full A4 PDF assembler ────────────────────────────────────────────────────
export function buildPdfHtml_V2(students, school, templateId, colors, cfg, HOST_NAME) {
  const tmpl = ID_CARD_TEMPLATES_V2.find(t => t.id === templateId);
  const isPortrait = tmpl?.orientation === 'portrait';
  const perPage = tmpl?.cardsPerPage ?? 3;

  const cards = students.map(s =>
    `<div class="card-wrap">${buildOneCardHtml_V2(templateId, s, school, colors, cfg, HOST_NAME)}</div>`
  );

  const pages = [];
  for (let i = 0; i < cards.length; i += perPage) {
    pages.push(`<div class="page">${cards.slice(i, i + perPage).join('')}</div>`);
  }

  const gridStyle = isPortrait
    ? 'display:grid;grid-template-columns:repeat(2,54mm);gap:5mm;justify-content:center;'
    : 'display:flex;flex-direction:column;align-items:center;gap:5mm;';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Arial,Helvetica,sans-serif;background:#fff;}
  @page{size:A4 portrait;margin:12mm 10mm;}
  .page{${gridStyle}page-break-after:always;padding:0;}
  .card-wrap{page-break-inside:avoid;break-inside:avoid;}
</style>
</head>
<body>${pages.join('')}</body>
</html>`;
}
