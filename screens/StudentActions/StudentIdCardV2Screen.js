/**
 * StudentIdCardV2Screen.js
 * Place at: screens/StudentActions/StudentIdCardV2Screen.js
 *
 * New multi-template ID card screen (10 templates).
 * The existing StudentIdCardScreen is NOT modified.
 *
 * Dependencies: expo-print  expo-sharing  (already installed for the existing screen)
 */

import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator, Alert, FlatList, Image, Modal,
  Pressable, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Print   from 'expo-print';
import * as Sharing from 'expo-sharing';
import { AuthContext } from '../../context/AuthContext';
import {
  fetchClasses, fetchSessions, fetchBranches,
  fetchSections, fetchIdCardData,
} from '../../services/StudentServiceApi';
import { fetchIdCardConfig } from '../../services/SchoolSettingsServiceApi';
import { HOST_NAME as _HOST } from '../../Environment/EnvironmentConfig';
import {
  ID_CARD_TEMPLATES_V2,
  ID_CARD_V2_DEFAULTS,
  CARD_LABELS_V2,
  buildPdfHtml_V2,
  buildOneCardHtml_V2,
} from '../../constants/IdCardTemplates';

const HOST_NAME = _HOST.replace(/\/+$/, '');

// ─── Colour swatches ──────────────────────────────────────────────────────────
const SWATCHES = [
  '#1d4ed8','#0c4a6e','#065f46','#14532d','#5b21b6',
  '#7c3aed','#c2410c','#be185d','#991b1b','#78350f',
  '#0369a1','#0284c7','#0891b2','#059669','#16a34a',
  '#ca8a04','#d97706','#dc2626','#e11d48','#9333ea',
  '#1e293b','#374151','#475569','#334155','#0f172a',
  '#fff','#f8fafc','#f1f5f9','#e2e8f0','#f5f3ff',
];

// ─── Tiny RN card preview (per template) ─────────────────────────────────────
// These are approximate visual previews using RN primitives.
// Landscape: 200 × 126  |  Portrait: 112 × 176  (in the preview list)

const CARD_W = 240;
const CARD_H = 185;
const CARD_W_P = 134;
const CARD_H_P = 255;

function CardPreviewRN({ template, student, school, colors, cfg }) {
  const { primary, accent } = colors;
  const isPortrait = template.orientation === 'portrait';
  const W = isPortrait ? CARD_W_P : CARD_W;
  const H = isPortrait ? CARD_H_P : CARD_H;
  const name = [student?.firstName, student?.lastName].filter(Boolean).join(' ') || 'Student Name';
  const classStr = [student?.className, student?.section].filter(Boolean).join(' / ') || 'Class X A';
  const photoUri = student?.photo && student?.ssmsClientCode && student?.registrationNo
    ? `${HOST_NAME}/clients/${student.ssmsClientCode}/Students/${student.registrationNo}/${student.photo}`
    : null;
  const logoUri = school?.logoUrl && school?.ssmsClientCode
    ? `${HOST_NAME}/clients/${school.ssmsClientCode}/${school.logoUrl}`
    : null;

  const commonProps = { W, H, primary, accent, name, classStr, photoUri, logoUri, cfg, school, student };

  switch (template.id) {
    case 'classic_horizontal':   return <Classic_Horizontal {...commonProps}/>;
    case 'vertical_portrait':    return <Vertical_Portrait  {...commonProps}/>;
    case 'left_spine':           return <Left_Spine         {...commonProps}/>;
    case 'diagonal_split':       return <Diagonal_Split     {...commonProps}/>;
    case 'top_banner':           return <Top_Banner         {...commonProps}/>;
    case 'wave_arc':             return <Wave_Arc           {...commonProps}/>;
    case 'diagonal_slash':       return <Diagonal_Slash     {...commonProps}/>;
    case 'corner_fan':           return <Corner_Fan         {...commonProps}/>;
    case 'portrait_wave':        return <Portrait_Wave      {...commonProps}/>;
    case 'ribbon_header':        return <Ribbon_Header      {...commonProps}/>;
    case 'badge_portrait':       return <Badge_Portrait     {...commonProps}/>;
    default:                     return <Wave_Arc           {...commonProps}/>;
  }
}

// shared sub-components
const PhotoCircle = ({ uri, size, border }) => (
  <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', borderWidth: 1.5, borderColor: border, backgroundColor: '#dde3ec' }}>
    {uri ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover"/>
          : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Feather name="user" size={size * 0.4} color="#94a3b8"/></View>}
  </View>
);
const LogoCircle = ({ uri, name: n, size, border }) => (
  <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', borderWidth: 1.5, borderColor: border, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
    {uri ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover"/>
          : <Text style={{ color: '#fff', fontWeight: '900', fontSize: size * 0.4 }}>{(n || 'S')[0].toUpperCase()}</Text>}
  </View>
);
const TextLine = ({ color, size, weight, children, opacity }) => (
  <Text style={{ color, fontSize: size, fontWeight: weight || '400', opacity: opacity || 1 }} numberOfLines={1}>{children}</Text>
);
// Shared footer — two stacked lines + principal label on the right
//   Line 1 (top):    phone icon circle + school phone number  [showSchoolPhone]
//   Line 2 (bottom): "If found…" small text                   [showIfFound]
//   Right side:      "Principal" label                        [showPrincipalSignature]
const SharedFooter = ({ primary, accent, phone, cfg, style }) => {
  const showPhone   = phone && cfg?.showSchoolPhone !== false;
  const showIfFound = (cfg?.showIfFound || cfg?.showIfFoundBar) && cfg?.ifFoundText;
  if (!showPhone && !showIfFound && cfg?.showPrincipalSignature === false) return null;
  return (
    <View style={[{ backgroundColor: primary, paddingHorizontal: 6, paddingVertical: 3, flexDirection: 'row', alignItems: 'flex-start', gap: 4 }, style]}>
      {/* Left column: phone row then if-found row — flex:1 clips to available width */}
      <View style={{ flex: 1, overflow: 'hidden' }}>
        {showPhone && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <View style={{ width: 11, height: 11, borderRadius: 5.5, borderWidth: 1, borderColor: accent, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Feather name="phone" size={5.5} color={accent}/>
            </View>
            <Text style={{ color: accent, fontSize: 5.5, fontWeight: '800', flex: 1 }} numberOfLines={1} ellipsizeMode="tail">{phone}</Text>
          </View>
        )}
        {showIfFound && (
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 4, lineHeight: 5.5, marginTop: showPhone ? 1 : 0 }} numberOfLines={1} ellipsizeMode="tail">{cfg.ifFoundText}</Text>
        )}
      </View>
      {/* Right: principal label — flexShrink:0 keeps it from being squeezed */}
      {cfg?.showPrincipalSignature !== false && (
        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 5, fontWeight: '700', flexShrink: 0, marginTop: 1 }}>Principal</Text>
      )}
    </View>
  );
};

const fmtDobRN = (raw) => {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d)) return raw;
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getUTCDate()).padStart(2,'0')} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
// Renders one detail row; returns null if value is blank (suppresses label+line too)
const PreviewDRow = ({ label, value, primary, labelW = 38 }) => {
  if (!value) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 0.5, borderColor: '#e2e8f0', paddingVertical: 1.5 }}>
      <Text style={{ fontSize: 5, fontWeight: '700', color: primary || '#64748b', width: labelW, flexShrink: 0 }} numberOfLines={1}>{label} :</Text>
      <Text style={{ flex: 1, fontSize: 5.5, fontWeight: '600', color: '#0f172a' }} numberOfLines={1}>{value}</Text>
    </View>
  );
};

function Classic_Horizontal({ W, H, primary, accent, name, classStr, photoUri, logoUri, cfg, school, student }) {
  const schoolName = school?.name || school?.schoolName || 'School';
  return (
    <View style={{ width: W, height: H, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 0.5, borderColor: '#e2e8f0' }}>
      <View style={{ backgroundColor: primary, padding: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <LogoCircle uri={logoUri} name={schoolName} size={26} border="rgba(255,255,255,0.5)"/>
        <Text style={{ color: '#fff', fontSize: 7, fontWeight: '900', flex: 1 }} numberOfLines={1}>{schoolName.toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ width: 68, backgroundColor: '#eef2f7', alignItems: 'center', padding: 6, gap: 4 }}>
          <PhotoCircle uri={photoUri} size={52} border={primary}/>
          <Text style={{ fontSize: 6, color: primary, fontWeight: '900' }} numberOfLines={1}>{classStr}</Text>
          {cfg?.showBloodGroup && student?.bloodGroup ? <View style={{ backgroundColor: accent, borderRadius: 4, paddingHorizontal: 4 }}><Text style={{ color: '#fff', fontSize: 5.5 }}>🩸 {student.bloodGroup}</Text></View> : null}
        </View>
        <View style={{ flex: 1, padding: 6 }}>
          <Text style={{ fontSize: 8, fontWeight: '900', color: primary, marginBottom: 2 }} numberOfLines={1}>{name.toUpperCase()}</Text>
          {cfg?.showFatherName !== false && <PreviewDRow label="Father" value={student?.fatherName} primary={primary} labelW={38}/>}
          {cfg?.showMotherName && <PreviewDRow label="Mother" value={student?.motherName} primary={primary} labelW={38}/>}
          {cfg?.showDateOfBirth !== false && <PreviewDRow label="DOB" value={fmtDobRN(student?.dob)} primary={primary} labelW={38}/>}
          {cfg?.showGender && <PreviewDRow label="Gender" value={student?.gender} primary={primary} labelW={38}/>}
          {cfg?.showParentPhone !== false && <PreviewDRow label="Contact" value={student?.parentPhone || student?.fatherPhone || student?.motherPhone} primary={primary} labelW={38}/>}
          {cfg?.showStudentAddress && <PreviewDRow label="Address" value={student?.address} primary={primary} labelW={38}/>}
        </View>
      </View>
      <SharedFooter primary={primary} accent={accent} phone={school?.phone || ''} cfg={cfg}/>
    </View>
  );
}

function Vertical_Portrait({ W, H, primary, accent, name, classStr, photoUri, logoUri, cfg, school, student }) {
  const schoolName = school?.name || school?.schoolName || 'School';
  const schoolAddress = school?.address || '';
  return (
    <View style={{ width: W, height: H, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 0.5, borderColor: '#e2e8f0' }}>
      {/* Compact header — school name + address */}
      <View style={{ backgroundColor: primary, paddingVertical: 6, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <LogoCircle uri={logoUri} name={schoolName} size={22} border="rgba(255,255,255,0.5)"/>
        <View style={{ flex: 1, overflow: 'hidden' }}>
          <Text style={{ color: '#fff', fontSize: 6.5, fontWeight: '900' }} numberOfLines={1}>{schoolName.toUpperCase()}</Text>
          {cfg?.showSchoolAddress !== false && !!schoolAddress && (
            <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 5 }} numberOfLines={1}>{schoolAddress}</Text>
          )}
        </View>
      </View>
      {/* Photo + name, in normal flow below header */}
      <View style={{ paddingTop: 12, paddingBottom: 4, alignItems: 'center', gap: 3 }}>
        <PhotoCircle uri={photoUri} size={52} border={primary}/>
        <Text style={{ fontSize: 8, fontWeight: '900', color: primary, marginTop: 2 }} numberOfLines={1}>{name.toUpperCase()}</Text>
        <Text style={{ fontSize: 6, color: accent, fontWeight: '700' }}>{classStr}</Text>
      </View>
      {/* Detail rows fill the remaining bottom area */}
      <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 2 }}>
        {cfg?.showFatherName !== false && <PreviewDRow label="Father" value={student?.fatherName} primary={primary} labelW={30}/>}
        {cfg?.showMotherName && <PreviewDRow label="Mother" value={student?.motherName} primary={primary} labelW={30}/>}
        {cfg?.showDateOfBirth !== false && <PreviewDRow label="DOB" value={fmtDobRN(student?.dob)} primary={primary} labelW={30}/>}
        {cfg?.showGender && <PreviewDRow label="Gender" value={student?.gender} primary={primary} labelW={30}/>}
        {cfg?.showParentPhone !== false && <PreviewDRow label="Contact" value={student?.parentPhone || student?.fatherPhone || student?.motherPhone} primary={primary} labelW={30}/>}
        {cfg?.showBloodGroup && student?.bloodGroup && <PreviewDRow label="Blood" value={student.bloodGroup} primary={primary} labelW={30}/>}
        {cfg?.showStudentAddress && <PreviewDRow label="Address" value={student?.address} primary={primary} labelW={30}/>}
      </View>
      <SharedFooter primary={primary} accent={accent} phone={school?.phone || ''} cfg={cfg}/>
    </View>
  );
}

function Left_Spine({ W, H, primary, accent, name, classStr, photoUri, logoUri, cfg, school, student }) {
  const schoolName = school?.name || school?.schoolName || 'School';
  return (
    <View style={{ width: W, height: H, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 0.5, borderColor: '#e2e8f0', flexDirection: 'column' }}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ width: 56, backgroundColor: primary, alignItems: 'center', padding: 6, gap: 5 }}>
          <LogoCircle uri={logoUri} name={schoolName} size={24} border="rgba(255,255,255,0.5)"/>
          <PhotoCircle uri={photoUri} size={40} border="rgba(255,255,255,0.4)"/>
          {cfg?.showBloodGroup && student?.bloodGroup ? <View style={{ backgroundColor: accent, borderRadius: 4, paddingHorizontal: 4 }}><Text style={{ color: '#fff', fontSize: 5 }}>🩸 {student.bloodGroup}</Text></View> : null}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ backgroundColor: accent, padding: 5 }}>
            <Text style={{ color: '#fff', fontSize: 7, fontWeight: '900' }} numberOfLines={1}>{schoolName.toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, padding: 6 }}>
            <Text style={{ fontSize: 8, fontWeight: '900', color: primary, marginBottom: 1 }} numberOfLines={1}>{name.toUpperCase()}</Text>
            <Text style={{ fontSize: 6, color: accent, fontWeight: '700', marginBottom: 3 }}>{classStr}</Text>
            {cfg?.showFatherName !== false && <PreviewDRow label="Father" value={student?.fatherName} primary={primary} labelW={34}/>}
            {cfg?.showMotherName && <PreviewDRow label="Mother" value={student?.motherName} primary={primary} labelW={34}/>}
            {cfg?.showDateOfBirth !== false && <PreviewDRow label="DOB" value={fmtDobRN(student?.dob)} primary={primary} labelW={34}/>}
            {cfg?.showGender && <PreviewDRow label="Gender" value={student?.gender} primary={primary} labelW={34}/>}
            {cfg?.showParentPhone !== false && <PreviewDRow label="Contact" value={student?.parentPhone || student?.fatherPhone || student?.motherPhone} primary={primary} labelW={34}/>}
            {cfg?.showStudentAddress && <PreviewDRow label="Address" value={student?.address} primary={primary} labelW={34}/>}
          </View>
        </View>
      </View>
      <SharedFooter primary={primary} accent={accent} phone={school?.phone || ''} cfg={cfg}/>
    </View>
  );
}

function Diagonal_Split({ W, H, primary, accent, name, classStr, photoUri, logoUri, cfg, school, student }) {
  const schoolName = school?.name || school?.schoolName || 'School';
  return (
    <View style={{ width: W, height: H, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 0.5, borderColor: '#e2e8f0' }}>
      <View style={{ position: 'absolute', top: 0, left: 0, width: '48%', height: '100%', backgroundColor: primary }}/>
      <View style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, borderStyle: 'solid', borderRightWidth: W * 0.18, borderBottomWidth: H, borderRightColor: 'transparent', borderBottomColor: '#fff', right: 0, left: W * 0.24 }}/>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row' }}>
        <View style={{ width: '46%', alignItems: 'center', padding: 6, gap: 4 }}>
          <LogoCircle uri={logoUri} name={schoolName} size={22} border="rgba(255,255,255,0.5)"/>
          <Text style={{ color: '#fff', fontSize: 5.5, fontWeight: '900', textAlign: 'center' }} numberOfLines={2}>{schoolName.toUpperCase()}</Text>
          <PhotoCircle uri={photoUri} size={38} border="rgba(255,255,255,0.6)"/>
        </View>
        <View style={{ flex: 1, padding: 6 }}>
          <Text style={{ fontSize: 7.5, fontWeight: '900', color: primary, marginBottom: 2 }} numberOfLines={1}>{name.toUpperCase()}</Text>
          <Text style={{ fontSize: 5.5, color: accent, fontWeight: '700', marginBottom: 3 }}>{classStr}</Text>
          {cfg?.showAdmissionNo !== false && <PreviewDRow label="Adm No" value={student?.admissionNumber} primary={primary} labelW={30}/>}
          {cfg?.showFatherName !== false && <PreviewDRow label="Father" value={student?.fatherName} primary={primary} labelW={30}/>}
          {cfg?.showMotherName && <PreviewDRow label="Mother" value={student?.motherName} primary={primary} labelW={30}/>}
          {cfg?.showDateOfBirth !== false && <PreviewDRow label="DOB" value={fmtDobRN(student?.dob)} primary={primary} labelW={30}/>}
          {cfg?.showGender && <PreviewDRow label="Gender" value={student?.gender} primary={primary} labelW={30}/>}
          {cfg?.showBloodGroup && student?.bloodGroup && <PreviewDRow label="Blood" value={student.bloodGroup} primary={primary} labelW={30}/>}
          {cfg?.showParentPhone !== false && <PreviewDRow label="Contact" value={student?.parentPhone || student?.fatherPhone || student?.motherPhone} primary={primary} labelW={30}/>}
          {cfg?.showStudentAddress && <PreviewDRow label="Address" value={student?.address} primary={primary} labelW={30}/>}
        </View>
      </View>
      <SharedFooter primary={primary} accent={accent} phone={school?.phone || ''} cfg={cfg} style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}/>
    </View>
  );
}

function Top_Banner({ W, H, primary, accent, name, classStr, photoUri, logoUri, cfg, school, student }) {
  const schoolName = school?.name || school?.schoolName || 'School';
  return (
    <View style={{ width: W, height: H, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 0.5, borderColor: '#e2e8f0' }}>
      <View style={{ backgroundColor: primary, padding: 6, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <LogoCircle uri={logoUri} name={schoolName} size={22} border="rgba(255,255,255,0.5)"/>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontSize: 7, fontWeight: '900' }} numberOfLines={1}>{schoolName.toUpperCase()}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 5 }} numberOfLines={1}>Address · Phone</Text>
        </View>
      </View>
      <View style={{ height: 2.5, backgroundColor: accent }}/>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ width: 62, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', padding: 5, borderRightWidth: 0.5, borderColor: '#e2e8f0', gap: 4 }}>
          <PhotoCircle uri={photoUri} size={48} border={primary}/>
          {cfg?.showBloodGroup && student?.bloodGroup ? <View style={{ backgroundColor: accent, borderRadius: 4, paddingHorizontal: 4 }}><Text style={{ color: '#fff', fontSize: 5 }}>🩸 {student.bloodGroup}</Text></View> : null}
        </View>
        <View style={{ flex: 1, padding: 6 }}>
          <Text style={{ fontSize: 7.5, fontWeight: '900', color: primary, marginBottom: 1 }} numberOfLines={1}>{name.toUpperCase()}</Text>
          <Text style={{ fontSize: 5.5, color: accent, fontWeight: '700', marginBottom: 2 }}>{classStr}</Text>
          {cfg?.showFatherName !== false && <PreviewDRow label="Father" value={student?.fatherName} primary={primary} labelW={34}/>}
          {cfg?.showMotherName && <PreviewDRow label="Mother" value={student?.motherName} primary={primary} labelW={34}/>}
          {cfg?.showDateOfBirth !== false && <PreviewDRow label="DOB" value={fmtDobRN(student?.dob)} primary={primary} labelW={34}/>}
          {cfg?.showGender && <PreviewDRow label="Gender" value={student?.gender} primary={primary} labelW={34}/>}
          {cfg?.showParentPhone !== false && <PreviewDRow label="Contact" value={student?.parentPhone || student?.fatherPhone || student?.motherPhone} primary={primary} labelW={34}/>}
          {cfg?.showStudentAddress && <PreviewDRow label="Address" value={student?.address} primary={primary} labelW={34}/>}
        </View>
      </View>
      <SharedFooter primary={primary} accent={accent} phone={school?.phone || ''} cfg={cfg}/>
    </View>
  );
}

function Wave_Arc({ W, H, primary, accent, name, classStr, photoUri, logoUri, cfg, school, student }) {
  const arcH = H * 0.42;
  const schoolName = school?.name || school?.schoolName || 'School';
  return (
    <View style={{ width: W, height: H, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 0.5, borderColor: '#e2e8f0' }}>
      <View style={{ position: 'absolute', top: 0, left: -W * 0.2, right: -W * 0.2, height: arcH + 18, backgroundColor: primary, borderBottomLeftRadius: 9999, borderBottomRightRadius: 9999 }}/>
      <View style={{ padding: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <LogoCircle uri={logoUri} name={schoolName} size={20} border="rgba(255,255,255,0.5)"/>
        <Text style={{ color: '#fff', fontSize: 6.5, fontWeight: '900', flex: 1 }} numberOfLines={1}>{schoolName.toUpperCase()}</Text>
      </View>
      <View style={{ alignItems: 'center', marginTop: 0 }}>
        <PhotoCircle uri={photoUri} size={H * 0.25} border={primary}/>
      </View>
      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 6, paddingTop: 2 }}>
        <Text style={{ fontSize: 8, fontWeight: '900', color: primary }} numberOfLines={1}>{name.toUpperCase()}</Text>
        <Text style={{ fontSize: 6, color: accent, fontWeight: '700', marginBottom: 2 }}>{classStr}</Text>
        {cfg?.showFatherName !== false && <PreviewDRow label="Father" value={student?.fatherName} primary={primary} labelW={26}/>}
        {cfg?.showMotherName && <PreviewDRow label="Mother" value={student?.motherName} primary={primary} labelW={26}/>}
        {cfg?.showDateOfBirth !== false && <PreviewDRow label="DOB" value={fmtDobRN(student?.dob)} primary={primary} labelW={26}/>}
        {cfg?.showGender && <PreviewDRow label="Gender" value={student?.gender} primary={primary} labelW={26}/>}
        {cfg?.showBloodGroup && student?.bloodGroup && <PreviewDRow label="Blood" value={student.bloodGroup} primary={primary} labelW={26}/>}
        {cfg?.showParentPhone !== false && <PreviewDRow label="Contact" value={student?.parentPhone || student?.fatherPhone || student?.motherPhone} primary={primary} labelW={26}/>}
        {cfg?.showStudentAddress && <PreviewDRow label="Address" value={student?.address} primary={primary} labelW={26}/>}
      </View>
      <SharedFooter primary={primary} accent={accent} phone={school?.phone || ''} cfg={cfg}/>
    </View>
  );
}

function Diagonal_Slash({ W, H, primary, accent, name, classStr, photoUri, logoUri, cfg, school, student }) {
  const schoolName = school?.name || school?.schoolName || 'School';
  return (
    <View style={{ width: W, height: H, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 0.5, borderColor: '#e2e8f0' }}>
      <View style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: primary }}/>
      <View style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, borderStyle: 'solid', borderRightWidth: W * 0.6, borderBottomWidth: H, borderRightColor: 'transparent', borderBottomColor: '#fff', left: W * 0.26 }}/>
      <View style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, borderStyle: 'solid', borderRightWidth: W * 0.1, borderBottomWidth: H, borderRightColor: 'transparent', borderBottomColor: accent, left: W * 0.16 }}/>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row' }}>
        <View style={{ width: '43%', alignItems: 'center', padding: 6, gap: 4 }}>
          <LogoCircle uri={logoUri} name={schoolName} size={22} border="rgba(255,255,255,0.5)"/>
          <Text style={{ color: '#fff', fontSize: 5.5, fontWeight: '900', textAlign: 'center' }} numberOfLines={2}>{schoolName.toUpperCase()}</Text>
          <PhotoCircle uri={photoUri} size={40} border="rgba(255,255,255,0.65)"/>
        </View>
        <View style={{ flex: 1, padding: 6 }}>
          <Text style={{ fontSize: 7.5, fontWeight: '900', color: primary, marginBottom: 1 }} numberOfLines={1}>{name.toUpperCase()}</Text>
          <Text style={{ fontSize: 5.5, color: accent, fontWeight: '700', marginBottom: 3 }}>{classStr}</Text>
          {cfg?.showAdmissionNo !== false && <PreviewDRow label="Adm No" value={student?.admissionNumber} primary={primary} labelW={30}/>}
          {cfg?.showFatherName !== false && <PreviewDRow label="Father" value={student?.fatherName} primary={primary} labelW={30}/>}
          {cfg?.showMotherName && <PreviewDRow label="Mother" value={student?.motherName} primary={primary} labelW={30}/>}
          {cfg?.showDateOfBirth !== false && <PreviewDRow label="DOB" value={fmtDobRN(student?.dob)} primary={primary} labelW={30}/>}
          {cfg?.showGender && <PreviewDRow label="Gender" value={student?.gender} primary={primary} labelW={30}/>}
          {cfg?.showBloodGroup && student?.bloodGroup && <PreviewDRow label="Blood" value={student.bloodGroup} primary={primary} labelW={30}/>}
          {cfg?.showParentPhone !== false && <PreviewDRow label="Contact" value={student?.parentPhone || student?.fatherPhone || student?.motherPhone} primary={primary} labelW={30}/>}
          {cfg?.showStudentAddress && <PreviewDRow label="Address" value={student?.address} primary={primary} labelW={30}/>}
        </View>
      </View>
      <SharedFooter primary={primary} accent={accent} phone={school?.phone || ''} cfg={cfg} style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}/>
    </View>
  );
}

function Corner_Fan({ W, H, primary, accent, name, classStr, photoUri, logoUri, cfg, school, student }) {
  const schoolName = school?.name || school?.schoolName || 'School';
  return (
    <View style={{ width: W, height: H, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 0.5, borderColor: '#e2e8f0' }}>
      <View style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: primary }}/>
      <View style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: accent, opacity: 0.9, transform: [{ skewY: '-22deg' }, { translateY: -H * 0.2 }] }}/>
      <View style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: H * 0.5, backgroundColor: `${accent}bb`, transform: [{ skewY: '-22deg' }, { translateY: -H * 0.3 }] }}/>
      <View style={{ position: 'absolute', bottom: 0, right: 0, width: W * 0.52, height: H * 0.55, backgroundColor: '#fff', borderTopLeftRadius: 8 }}/>
      <View style={{ position: 'absolute', top: 6, left: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <LogoCircle uri={logoUri} name={schoolName} size={22} border="rgba(255,255,255,0.5)"/>
        <Text style={{ color: '#fff', fontSize: 6, fontWeight: '900', maxWidth: 80 }} numberOfLines={1}>{schoolName.toUpperCase()}</Text>
      </View>
      <View style={{ position: 'absolute', top: 30, left: 6 }}>
        <PhotoCircle uri={photoUri} size={46} border="rgba(255,255,255,0.65)"/>
      </View>
      <View style={{ position: 'absolute', bottom: 34, left: 10, right: W * 0.5 + 4 }}>
        <Text style={{ color: 'rgba(255,255,255,0.95)', fontSize: 6.5, fontWeight: '900' }} numberOfLines={1}>{name.toUpperCase()}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 5 }}>{classStr}</Text>
      </View>
      <View style={{ position: 'absolute', bottom: 26, right: 6, width: W * 0.48 }}>
        {cfg?.showFatherName !== false && <PreviewDRow label="Father" value={student?.fatherName} primary={primary} labelW={26}/>}
        {cfg?.showMotherName && <PreviewDRow label="Mother" value={student?.motherName} primary={primary} labelW={26}/>}
        {cfg?.showDateOfBirth !== false && <PreviewDRow label="DOB" value={fmtDobRN(student?.dob)} primary={primary} labelW={26}/>}
        {cfg?.showGender && <PreviewDRow label="Gender" value={student?.gender} primary={primary} labelW={26}/>}
        {cfg?.showParentPhone !== false && <PreviewDRow label="Contact" value={student?.parentPhone || student?.fatherPhone || student?.motherPhone} primary={primary} labelW={26}/>}
        {cfg?.showStudentAddress && <PreviewDRow label="Address" value={student?.address} primary={primary} labelW={26}/>}
      </View>
      <SharedFooter primary={primary} accent={accent} phone={school?.phone || ''} cfg={cfg} style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}/>
    </View>
  );
}

function Portrait_Wave({ W, H, primary, accent, name, classStr, photoUri, logoUri, cfg, school, student }) {
  const arcH = H * 0.32;
  const schoolName = school?.name || school?.schoolName || 'School';
  return (
    <View style={{ width: W, height: H, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 0.5, borderColor: '#e2e8f0' }}>
      <View style={{ position: 'absolute', top: 0, left: -W * 0.3, right: -W * 0.3, height: arcH + 6, backgroundColor: primary, borderBottomLeftRadius: 9999, borderBottomRightRadius: 9999 }}/>
      <View style={{ alignItems: 'center', paddingTop: 7, gap: 3 }}>
        <LogoCircle uri={logoUri} name={schoolName} size={22} border="rgba(255,255,255,0.5)"/>
        <Text style={{ color: '#fff', fontSize: 6.5, fontWeight: '900' }} numberOfLines={1}>{schoolName.toUpperCase()}</Text>
      </View>
      <View style={{ alignItems: 'center', marginTop: 4 }}>
        <PhotoCircle uri={photoUri} size={W * 0.38} border={primary}/>
      </View>
      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 8, paddingTop: 6 }}>
        <Text style={{ fontSize: 8, fontWeight: '900', color: primary }} numberOfLines={1}>{name.toUpperCase()}</Text>
        <Text style={{ fontSize: 6, color: accent, fontWeight: '700', marginBottom: 3 }}>{classStr}</Text>
        {cfg?.showFatherName !== false && <PreviewDRow label="Father" value={student?.fatherName} primary={primary} labelW={30}/>}
        {cfg?.showMotherName && <PreviewDRow label="Mother" value={student?.motherName} primary={primary} labelW={30}/>}
        {cfg?.showDateOfBirth !== false && <PreviewDRow label="DOB" value={fmtDobRN(student?.dob)} primary={primary} labelW={30}/>}
        {cfg?.showGender && <PreviewDRow label="Gender" value={student?.gender} primary={primary} labelW={30}/>}
        {cfg?.showBloodGroup && student?.bloodGroup && <PreviewDRow label="Blood" value={student.bloodGroup} primary={primary} labelW={30}/>}
        {cfg?.showParentPhone !== false && <PreviewDRow label="Contact" value={student?.parentPhone || student?.fatherPhone || student?.motherPhone} primary={primary} labelW={30}/>}
        {cfg?.showStudentAddress && <PreviewDRow label="Address" value={student?.address} primary={primary} labelW={30}/>}
      </View>
      <SharedFooter primary={primary} accent={accent} phone={school?.phone || ''} cfg={cfg}/>
    </View>
  );
}

function Ribbon_Header({ W, H, primary, accent, name, classStr, photoUri, logoUri, cfg, school, student }) {
  const schoolName = school?.name || school?.schoolName || 'School';
  return (
    <View style={{ width: W, height: H, borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 0.5, borderColor: '#e2e8f0' }}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: H * 0.40, backgroundColor: primary, transform: [{ skewY: '-4deg' }, { translateY: -4 }] }}/>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: H * 0.26, backgroundColor: accent, transform: [{ skewY: '-4deg' }, { translateY: -3 }] }}/>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: H * 0.14, backgroundColor: `${accent}cc`, transform: [{ skewY: '-4deg' }, { translateY: -2 }] }}/>
      <View style={{ position: 'absolute', top: 5, left: 6, right: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <LogoCircle uri={logoUri} name={schoolName} size={20} border="rgba(255,255,255,0.5)"/>
        <Text style={{ color: '#fff', fontSize: 6.5, fontWeight: '900', flex: 1 }} numberOfLines={1}>{schoolName.toUpperCase()}</Text>
      </View>
      <View style={{ position: 'absolute', top: H * 0.29, left: 6, bottom: 10 }}>
        <PhotoCircle uri={photoUri} size={58} border={primary}/>
      </View>
      <View style={{ position: 'absolute', top: H * 0.38, left: 72, right: 6, bottom: 10 }}>
        <Text style={{ fontSize: 7.5, fontWeight: '900', color: primary, marginBottom: 1 }} numberOfLines={1}>{name.toUpperCase()}</Text>
        <Text style={{ fontSize: 5.5, color: accent, fontWeight: '700', marginBottom: 3 }}>{classStr}</Text>
        {cfg?.showFatherName !== false && <PreviewDRow label="Father" value={student?.fatherName} primary={primary} labelW={28}/>}
        {cfg?.showMotherName && <PreviewDRow label="Mother" value={student?.motherName} primary={primary} labelW={28}/>}
        {cfg?.showDateOfBirth !== false && <PreviewDRow label="DOB" value={fmtDobRN(student?.dob)} primary={primary} labelW={28}/>}
        {cfg?.showGender && <PreviewDRow label="Gender" value={student?.gender} primary={primary} labelW={28}/>}
        {cfg?.showParentPhone !== false && <PreviewDRow label="Contact" value={student?.parentPhone || student?.fatherPhone || student?.motherPhone} primary={primary} labelW={28}/>}
        {cfg?.showStudentAddress && <PreviewDRow label="Address" value={student?.address} primary={primary} labelW={28}/>}
      </View>
      <SharedFooter primary={primary} accent={accent} phone={school?.phone || ''} cfg={cfg} style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}/>
    </View>
  );
}

function Badge_Portrait({ W, H, primary, accent, name, classStr, photoUri, logoUri, cfg, school, student }) {
  const headerH  = Math.round(H * 0.27);
  const cornerW  = Math.round(W * 0.26);
  const cornerH  = Math.round(headerH * 0.58);
  const schoolName = school?.name || school?.schoolName || 'School Name';
  const phone      = school?.phone || '';
  const address    = school?.address || '';

  const fmtDob = (raw) => {
    if (!raw) return '';
    const d = new Date(raw);
    if (isNaN(d)) return raw;
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${String(d.getUTCDate()).padStart(2,'0')} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };

  // Config-driven rows — skips any row whose value is blank (mirrors PDF dLine behaviour)
  const rows = [
    { label: 'Full Name',       value: name },
    cfg?.showAdmissionNo !== false && { label: 'Adm. No.',       value: student?.admissionNumber },
    { label: 'Class',           value: classStr },
    cfg?.showDateOfBirth  !== false && { label: 'Date of Birth',  value: fmtDob(student?.dob) },
    cfg?.showGender             && { label: 'Gender',            value: student?.gender },
    cfg?.showFatherName   !== false && { label: "Father's Name",  value: student?.fatherName },
    cfg?.showMotherName         && { label: "Mother's Name",      value: student?.motherName },
    cfg?.showBloodGroup && student?.bloodGroup && { label: 'Blood Group', value: student.bloodGroup },
    cfg?.showParentPhone  !== false && { label: 'Mobile No.',     value: student?.parentPhone || student?.fatherPhone || student?.motherPhone },
    cfg?.showStudentAddress     && { label: 'Address',            value: student?.address },
  ].filter(r => r && r.value);

  const DRow = ({ label, value }) => (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 2.2 }}>
      <Text style={{ width: 41, fontSize: 4.6, fontWeight: '700', color: primary, lineHeight: 7, flexShrink: 0 }} numberOfLines={1}>{label} :</Text>
      <View style={{ flex: 1, borderBottomWidth: 0.7, borderColor: primary, minHeight: 7 }}>
        {value ? <Text style={{ fontSize: 5, fontWeight: '600', color: '#0f172a', lineHeight: 7 }} numberOfLines={1}>{value}</Text> : null}
      </View>
    </View>
  );

  return (
    <View style={{ width: W, height: H, borderRadius: 8, overflow: 'hidden', backgroundColor: '#e8f4ff', borderWidth: 1, borderColor: primary }}>

      {/* ── HEADER ─────────────────────────────────────────────── */}
      <View style={{ height: headerH, backgroundColor: '#e8f4ff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, paddingTop: 4 }}>
        {/* Navy fill — the full header */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: headerH, backgroundColor: primary }}/>
        {/* Corner masks — card-bg color with large border-radius to simulate the arc cutouts */}
        <View style={{ position: 'absolute', bottom: 0, left: 0,  width: cornerW, height: cornerH, backgroundColor: '#e8f4ff', borderTopRightRadius: 999 }}/>
        <View style={{ position: 'absolute', bottom: 0, right: 0, width: cornerW, height: cornerH, backgroundColor: '#e8f4ff', borderTopLeftRadius:  999 }}/>
        {/* School name */}
        <Text style={{ color: accent, fontSize: 8, fontWeight: '900', textAlign: 'center', lineHeight: 11, zIndex: 1 }} numberOfLines={2}>{schoolName}</Text>
        {cfg?.showTagline
          ? <Text style={{ color: 'rgba(255,255,255,0.70)', fontSize: 4.5, textAlign: 'center', zIndex: 1, marginTop: 1 }} numberOfLines={1}>{cfg.taglineText || 'LEARN · GROW · SUCCEED'}</Text>
          : null}
        {address
          ? <View style={{ backgroundColor: accent, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1.5, marginTop: 2, zIndex: 1 }}>
              <Text style={{ color: primary, fontSize: 4.8, fontWeight: '800' }} numberOfLines={1}>{address}</Text>
            </View>
          : null}
      </View>

      {/* ── BADGE LABEL ────────────────────────────────────────── */}
      <View style={{ backgroundColor: '#cc1122', borderRadius: 5, marginHorizontal: 6, marginTop: 3, marginBottom: 2, alignItems: 'center', paddingVertical: 2.5 }}>
        <Text style={{ color: '#fff', fontSize: 6.5, fontWeight: '900' }}>Student Identity Card</Text>
      </View>

      {/* ── LOGO + PHOTO ────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 7, paddingBottom: 2 }}>
        <LogoCircle uri={logoUri} name={schoolName} size={24} border={accent}/>
        <View style={{ width: 26, height: 30, borderRadius: 3, overflow: 'hidden', borderWidth: 1.2, borderColor: '#2563eb', backgroundColor: '#dde3ec' }}>
          {photoUri
            ? <Image source={{ uri: photoUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover"/>
            : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Feather name="user" size={11} color="#94a3b8"/></View>}
        </View>
      </View>

      {/* ── DETAILS BOX ─────────────────────────────────────────── */}
      <View style={{ flex: 1, borderWidth: 1, borderColor: '#6ea8d8', borderRadius: 4, marginHorizontal: 4, marginBottom: 2, padding: 4, backgroundColor: '#fff', overflow: 'hidden' }}>
        {rows.map((r, i) => <DRow key={i} label={r.label} value={r.value}/>)}
      </View>

      {/* ── FOOTER ── */}
      <SharedFooter primary={primary} accent={accent} phone={phone} cfg={cfg}/>

    </View>
  );
}

// ─── Dropdown (same pattern as StudentIdCardScreen) ───────────────────────────
function Dropdown({ label, value, options, onChange, disabled }) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[dd.trigger, disabled && dd.disabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.75}
      >
        <Text style={[dd.triggerTxt, !selected && dd.placeholder]} numberOfLines={1}>
          {selected?.label ?? label}
        </Text>
        <Feather name="chevron-down" size={15} color="#64748b"/>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={dd.overlay} onPress={() => setOpen(false)}>
          <Pressable style={dd.sheet} onPress={() => {}}>
            <Text style={dd.sheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[dd.option, String(o.value) === String(value) && dd.optionActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[dd.optionTxt, String(o.value) === String(value) && dd.optionTxtActive]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) && <Feather name="check" size={14} color="#2563eb"/>}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#f1f5f9' }}/>}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
const dd = StyleSheet.create({
  trigger:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 11 },
  disabled:       { opacity: 0.4 },
  triggerTxt:     { flex: 1, fontSize: 13.5, color: '#0f172a', fontWeight: '500' },
  placeholder:    { color: '#94a3b8' },
  overlay:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', paddingHorizontal: 20 },
  sheet:          { backgroundColor: '#fff', borderRadius: 18, padding: 16, maxHeight: '72%' },
  sheetTitle:     { fontSize: 15, fontWeight: '800', color: '#0f172a', marginBottom: 10 },
  option:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10 },
  optionActive:   { backgroundColor: '#eff6ff' },
  optionTxt:      { fontSize: 14, color: '#0f172a' },
  optionTxtActive:{ color: '#2563eb', fontWeight: '700' },
});

// ─── Colour picker modal ──────────────────────────────────────────────────────
function ColourPicker({ visible, title, current, onSelect, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={cp.overlay} onPress={onClose}>
        <Pressable style={cp.sheet} onPress={e => e.stopPropagation()}>
          <View style={cp.handle}/>
          <Text style={cp.title}>{title}</Text>
          <View style={cp.swatchGrid}>
            {SWATCHES.map(c => (
              <TouchableOpacity key={c} style={[cp.swatch, { backgroundColor: c }, current === c && cp.swatchSel]}
                onPress={() => { onSelect(c); onClose(); }}/>
            ))}
          </View>
          <TextInput
            style={cp.hexInput}
            value={current}
            onChangeText={v => { if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) onSelect(v); }}
            placeholder="#hex"
            autoCapitalize="none"
            maxLength={7}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function StudentIdCardV2Screen({ navigation }) {
  const { user: userInfo } = useContext(AuthContext);

  // ── Pickers state (IDs stored as strings, matching API field names) ────────
  const [sessions,   setSessions]   = useState([]);
  const [branches,   setBranches]   = useState([]);
  const [classes,    setClasses]    = useState([]);
  const [sections,   setSections]   = useState([]);
  const [sessionId,  setSessionId]  = useState('');
  const [branchId,   setBranchId]   = useState('');
  const [classId,    setClassId]    = useState('');
  const [sectionId,  setSectionId]  = useState('');

  // ── Template + colours ──────────────────────────────────────────────────────
  const [templateId, setTemplateId] = useState('wave_arc');
  const [primary,    setPrimary]    = useState('#1d4ed8');
  const [accent,     setAccent]     = useState('#1e40af');
  const [cfg,        setCfg]        = useState(ID_CARD_V2_DEFAULTS);

  // ── Colour picker modal ─────────────────────────────────────────────────────
  const [pickerTarget, setPickerTarget] = useState(null); // 'primary' | 'accent'

  // ── Data ────────────────────────────────────────────────────────────────────
  const [students,   setStudents]   = useState([]);
  const [schoolInfo, setSchoolInfo] = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [exporting,  setExporting]  = useState(false);

  // ── Load sessions + branches on focus ──────────────────────────────────────
  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      try {
        const [sess, br] = await Promise.all([fetchSessions(userInfo), fetchBranches(userInfo)]);
        if (!active) return;
        setSessions(sess || []);
        setBranches(br  || []);
        // Auto-select when only one option exists
        if (sess?.length === 1) setSessionId(String(sess[0].session_id));
        if (br?.length  === 1)  setBranchId(String(br[0].branch_id));
        // Load saved V2 config
        const savedCfg = await fetchIdCardConfig(userInfo);
        if (savedCfg && active) {
          setCfg({ ...ID_CARD_V2_DEFAULTS, ...savedCfg });
          if (savedCfg.cardTemplateV2) setTemplateId(savedCfg.cardTemplateV2);
          if (savedCfg.cardPrimaryV2)  setPrimary(savedCfg.cardPrimaryV2);
          if (savedCfg.cardAccentV2)   setAccent(savedCfg.cardAccentV2);
        }
      } catch (e) { /* silent */ }
    })();
    return () => { active = false; };
  }, []));

  // Reload classes whenever branch changes
  useEffect(() => {
    setClasses([]); setClassId(''); setSections([]); setSectionId('');
    if (!branchId) return;
    fetchClasses(userInfo)
      .then(r => {
        const list = r || [];
        setClasses(list);
        if (list.length === 1) setClassId(String(list[0].class_id));
      })
      .catch(() => {});
  }, [branchId]);

  // Reload sections whenever class changes
  useEffect(() => {
    setSections([]); setSectionId('');
    if (!classId) return;
    fetchSections(userInfo, classId)
      .then(r => {
        const list = r || [];
        setSections(list);
        if (list.length === 1) setSectionId(String(list[0].section_id));
      })
      .catch(() => {});
  }, [classId]);

  // ── Load students ────────────────────────────────────────────────────────────
  const loadStudents = useCallback(async () => {
    if (!sessionId) { Alert.alert('Validation', 'Please select a session.'); return; }
    if (!classId)   { Alert.alert('Validation', 'Please select a class.');   return; }
    setLoading(true);
    setStudents([]);
    try {
      const res = await fetchIdCardData(userInfo, { sessionId, branchId, classId, sectionId });
      setStudents(res?.students || []);
      setSchoolInfo(res?.school  || null);
    } catch (e) {
      Alert.alert('Error', 'Could not load students.');
    } finally {
      setLoading(false);
    }
  }, [sessionId, branchId, classId, sectionId]);

  // ── Export PDF ──────────────────────────────────────────────────────────────
  const exportPdf = async () => {
    if (!students.length) { Alert.alert('No students', 'Load students first.'); return; }
    setExporting(true);
    try {
      const html = buildPdfHtml_V2(students, schoolInfo, templateId, { primary, accent }, cfg, HOST_NAME);
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share ID Cards PDF' });
    } catch (e) {
      Alert.alert('Export failed', e.message);
    } finally {
      setExporting(false);
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const selTemplate = ID_CARD_TEMPLATES_V2.find(t => t.id === templateId) || ID_CARD_TEMPLATES_V2[0];
  const colors = { primary, accent };

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="arrow-left" size={22} color="#0f172a"/>
        </TouchableOpacity>
        <Text style={s.headerTitle}>ID Cards v2</Text>
        <TouchableOpacity onPress={exportPdf} style={[s.exportBtn, { backgroundColor: primary }]} disabled={exporting}>
          {exporting ? <ActivityIndicator size="small" color="#fff"/>
                     : <><Feather name="download" size={14} color="#fff"/><Text style={s.exportTxt}> Export PDF</Text></>}
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>

        {/* ── Template selector ── */}
        <Text style={s.sectionLabel}>Choose Template</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.templateStrip}>
          {ID_CARD_TEMPLATES_V2.map(t => (
            <TouchableOpacity key={t.id} onPress={() => {
              setTemplateId(t.id);
              setPrimary(t.defaultPrimary);
              setAccent(t.defaultAccent);
            }} style={[s.tmplCard, templateId === t.id && { borderColor: primary, borderWidth: 2 }]}>
              <View style={[s.tmplDot, { backgroundColor: t.defaultPrimary }]}/>
              <Text style={[s.tmplName, templateId === t.id && { color: primary }]} numberOfLines={2}>{t.name}</Text>
              <Text style={s.tmplDesc} numberOfLines={2}>{t.description}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── Colour pickers ── */}
        <View style={s.colourRow}>
          <TouchableOpacity style={s.colourBtn} onPress={() => setPickerTarget('primary')}>
            <View style={[s.colourSwatch, { backgroundColor: primary }]}/>
            <Text style={s.colourLabel}>Primary</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.colourBtn} onPress={() => setPickerTarget('accent')}>
            <View style={[s.colourSwatch, { backgroundColor: accent }]}/>
            <Text style={s.colourLabel}>Accent</Text>
          </TouchableOpacity>
        </View>

        {/* ── Filter dropdowns ── */}
        <Text style={s.sectionLabel}>Filter Students</Text>
        <View style={s.filterGrid}>
          <View style={s.filterRow}>
            <View style={s.filterCell}>
              <Text style={s.filterLabel}>Session</Text>
              <Dropdown
                label="Select Session"
                value={sessionId}
                options={sessions
                  .filter(s => s.session_id != null)
                  .map(s => ({ value: String(s.session_id), label: s.session_name ?? s.session_year ?? `Session ${s.session_id}` }))}
                onChange={v => setSessionId(v)}
              />
            </View>
            <View style={s.filterCell}>
              <Text style={s.filterLabel}>Branch</Text>
              <Dropdown
                label="Select Branch"
                value={branchId}
                options={branches
                  .filter(b => b.branch_id != null)
                  .map(b => ({ value: String(b.branch_id), label: b.branch_name ?? `Branch ${b.branch_id}` }))}
                onChange={v => setBranchId(v)}
                disabled={!branches.length}
              />
            </View>
          </View>
          <View style={s.filterRow}>
            <View style={s.filterCell}>
              <Text style={s.filterLabel}>Class</Text>
              <Dropdown
                label="Select Class"
                value={classId}
                options={classes
                  .filter(c => c.class_id != null && c.class_name)
                  .map(c => ({ value: String(c.class_id), label: c.class_name }))}
                onChange={v => setClassId(v)}
                disabled={!classes.length}
              />
            </View>
            <View style={s.filterCell}>
              <Text style={s.filterLabel}>Section</Text>
              <Dropdown
                label="All Sections"
                value={sectionId}
                options={[
                  { value: '', label: 'All Sections' },
                  ...sections
                    .filter(s => s.section_id != null)
                    .map(s => ({ value: String(s.section_id), label: s.section_name ?? `Section ${s.section_id}` })),
                ]}
                onChange={v => setSectionId(v)}
                disabled={!sections.length}
              />
            </View>
          </View>
        </View>

        <TouchableOpacity style={[s.loadBtn, { backgroundColor: primary }]} onPress={loadStudents} disabled={loading}>
          {loading ? <ActivityIndicator size="small" color="#fff"/>
                   : <Text style={s.loadBtnTxt}>Load Students</Text>}
        </TouchableOpacity>

        {/* ── Card list preview ── */}
        {students.length > 0 && (
          <>
            <Text style={s.sectionLabel}>{students.length} students · {selTemplate.name}</Text>
            <FlatList
              data={students}
              keyExtractor={(_, i) => String(i)}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 16 }}
              renderItem={({ item }) => (
                <View style={{ padding: 4 }}>
                  <CardPreviewRN
                    template={selTemplate}
                    student={item}
                    school={schoolInfo}
                    colors={colors}
                    cfg={cfg}
                  />
                  <Text style={[s.cardStudentName, { width: selTemplate.orientation === 'portrait' ? CARD_W_P : CARD_W }]} numberOfLines={1}>
                    {[item.firstName, item.lastName].filter(Boolean).join(' ')}
                  </Text>
                </View>
              )}
              scrollEnabled
            />
          </>
        )}

        <View style={{ height: 32 }}/>
      </ScrollView>

      {/* Colour picker modal */}
      <ColourPicker
        visible={!!pickerTarget}
        title={pickerTarget === 'primary' ? 'Primary Colour' : 'Accent Colour'}
        current={pickerTarget === 'primary' ? primary : accent}
        onSelect={v => pickerTarget === 'primary' ? setPrimary(v) : setAccent(v)}
        onClose={() => setPickerTarget(null)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: '#fff' },
  header:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderColor: '#e2e8f0' },
  backBtn:       { padding: 4, marginRight: 8 },
  headerTitle:   { flex: 1, fontSize: 17, fontWeight: '700', color: '#0f172a' },
  exportBtn:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  exportTxt:     { color: '#fff', fontSize: 13, fontWeight: '700' },
  sectionLabel:  { fontSize: 13, fontWeight: '700', color: '#475569', marginHorizontal: 16, marginTop: 14, marginBottom: 6 },
  templateStrip: { paddingHorizontal: 16, gap: 10, paddingBottom: 4 },
  tmplCard:      { width: 110, padding: 8, borderRadius: 10, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  tmplDot:       { width: 18, height: 18, borderRadius: 9, marginBottom: 5 },
  tmplName:      { fontSize: 11, fontWeight: '700', color: '#1e293b', marginBottom: 2 },
  tmplDesc:      { fontSize: 9, color: '#64748b', lineHeight: 13 },
  colourRow:     { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 10, marginBottom: 4 },
  colourBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, backgroundColor: '#f8fafc', borderRadius: 10, borderWidth: 0.5, borderColor: '#e2e8f0' },
  colourSwatch:  { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: '#e2e8f0' },
  colourLabel:   { fontSize: 13, fontWeight: '600', color: '#374151' },
  filterGrid:    { paddingHorizontal: 16, gap: 10, marginBottom: 4 },
  filterRow:     { flexDirection: 'row', gap: 10 },
  filterCell:    { flex: 1 },
  filterLabel:   { fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
  loadBtn:       { marginHorizontal: 16, marginTop: 8, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  loadBtnTxt:    { color: '#fff', fontSize: 14, fontWeight: '700' },
  cardStudentName:{ fontSize: 10, color: '#475569', marginTop: 4, textAlign: 'center' },
});

const cp = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:      { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 32 },
  handle:     { width: 36, height: 4, backgroundColor: '#e2e8f0', borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  title:      { fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 14, textAlign: 'center' },
  swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 14 },
  swatch:     { width: 36, height: 36, borderRadius: 18, borderWidth: 0.5, borderColor: '#e2e8f0' },
  swatchSel:  { borderWidth: 2.5, borderColor: '#0f172a' },
  hexInput:   { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: '#0f172a', fontFamily: 'monospace' },
});
