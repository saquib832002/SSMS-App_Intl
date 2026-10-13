/**
 * components/Charts.js – small SVG charts for the analytics screens (react-native-svg).
 *
 * Colour rules (validated palette, light surface):
 *   series 1 #2a78d6 (blue) · series 2 #eb6834 (orange) · series 3 #1baf7a (aqua – always with a direct label)
 *   status: good #0ca30c · warning #fab219 · serious #ec835a · critical #d03b3b – never colour alone (icon + words)
 * Text always uses ink colours, never the series colour. One y-axis per chart. Tap (or drag) a
 * chart to see exact values.
 */
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Path, Line, Circle, G, Text as SvgText, Rect } from "react-native-svg";
import { _t, _tx } from "../services/i18n";

export const PALETTE = { s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a" };
export const STATUS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" };
export const INK = { primary: "#0f172a", secondary: "#334155", muted: "#64748b", grid: "#e2e8f0", axis: "#cbd5e1", surface: "#ffffff" };

const PAD = { l: 38, r: 10, t: 12, b: 24 };

/** Round numbers for the axis: 0–100 for percentages, otherwise 0 → a "nice" maximum. */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** How many grid steps give round labels (0, 10K, 20K … rather than 12.5K, 37.5K). */
function stepsFor(lo, hi) {
  const span = hi - lo;
  if (!(span > 0)) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(span)));
  const f = Math.round((span / p) * 100) / 100;
  return f === 2 || f === 4 || f === 8 ? 4 : f === 3 || f === 6 || f === 9 ? 3 : 5;
}

function ticks(min, max, n = stepsFor(min, max)) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(min + ((max - min) * i) / n);
  return out;
}

/** Bar with 4px rounded top corners, anchored to the baseline. */
function barPath(x, y, w, h, r = 4) {
  if (h <= 0 || w <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

function useWidth() {
  const [w, setW] = useState(0);
  return [w, (e) => { const nw = Math.round(e.nativeEvent.layout.width); if (nw && Math.abs(nw - w) > 1) setW(nw); }];
}

/** Touch layer: tap or drag to pick the nearest column; vertical scrolling still wins. */
function useTouch(n, plotX0, step) {
  const [idx, setIdx] = useState(null);
  const [seenN, setSeenN] = useState(n);
  if (seenN !== n) { setSeenN(n); setIdx(null); }   // new data: drop the old selection
  const pick = (x) => {
    if (!n) return;
    const i = step > 0 ? Math.round((x - plotX0) / step) : 0;
    setIdx(Math.max(0, Math.min(n - 1, i)));
  };
  const handlers = {
    onStartShouldSetResponder: () => true,
    onResponderGrant: (e) => pick(e.nativeEvent.locationX),
    onResponderMove: (e) => pick(e.nativeEvent.locationX),
    onResponderTerminationRequest: () => true,
  };
  return [idx, setIdx, handlers];
}

function Tooltip({ x, width, title, rows }) {
  const w = 150;
  const left = Math.max(4, Math.min(width - w - 4, x - w / 2));
  return (
    <View pointerEvents="none" style={[s.tip, { left, width: w }]}>
      <Text style={s.tipTitle} numberOfLines={1}>{_tx(title)}</Text>
      {rows.map((r, i) => (
        <View key={i} style={s.tipRow}>
          {!!r.color && <View style={[s.tipSwatch, { backgroundColor: r.color }, r.dash && { height: 2, borderRadius: 0 }]} />}
          <Text style={s.tipName} numberOfLines={1}>{_tx(r.name)}</Text>
          <Text style={s.tipVal}>{_tx(r.value)}</Text>
        </View>
      ))}
    </View>
  );
}

export function Legend({ items }) {
  if (!items || items.length < 2) return null;   // one series: the card title names it
  return (
    <View style={s.legend}>
      {items.map((it) => (
        <View key={it.name} style={s.legendItem}>
          {it.type === "dash" ? <View style={[s.legendDash, { backgroundColor: it.color }]} />
            : it.type === "line" ? <View style={[s.legendLine, { backgroundColor: it.color }]} />
            : <View style={[s.legendBox, { backgroundColor: it.color }]} />}
          <Text style={s.legendTxt}>{_tx(it.name)}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Line chart.
 * labels: x labels (short); titles: tooltip titles (optional); series: [{ name, color, values: [number|null] }]
 * percent: y axis 0–100; refLines: [{ y, label }]; format: value → text
 */
export function LineChart({ labels = [], titles, series = [], height = 190, percent = false, yMin, refLines = [], format = (v) => String(v) }) {
  const [width, onLayout] = useWidth();
  const n = labels.length;
  const plotW = Math.max(1, width - PAD.l - PAD.r);
  const plotH = height - PAD.t - PAD.b;
  const step = n > 1 ? plotW / (n - 1) : 0;
  const x = (i) => PAD.l + (n > 1 ? i * step : plotW / 2);
  const { lo, hi } = useMemo(() => {
    if (percent) {
      const vals = series.flatMap((sr) => sr.values).filter((v) => v !== null && v !== undefined);
      const mn = Math.min(...vals, ...refLines.map((r) => r.y), 100);
      const floor = yMin ?? (mn >= 60 ? Math.floor((mn - 5) / 10) * 10 : 0);
      return { lo: Math.max(0, Math.min(floor, 100)), hi: 100 };
    }
    const mx = Math.max(0, ...series.flatMap((sr) => sr.values).filter((v) => v !== null && v !== undefined), ...refLines.map((r) => r.y));
    return { lo: yMin ?? 0, hi: niceMax(mx) };
  }, [series, percent, yMin, refLines]);
  const y = (v) => PAD.t + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const [idx, , touch] = useTouch(n, PAD.l, step);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 54))));

  const paths = series.map((sr) => {
    let d = "";
    let pen = false;
    sr.values.forEach((v, i) => {
      if (v === null || v === undefined || Number.isNaN(+v)) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(Math.max(lo, +v)).toFixed(1)} `;
      pen = true;
    });
    return d;
  });

  return (
    <View onLayout={onLayout} style={{ height }} accessible accessibilityLabel={_t("Line chart, {v}", { v: series.map((x2) => x2.name).join(", ") })}>
      {width > 0 && (
        <View {...touch}>
          <Svg width={width} height={height}>
            {ticks(lo, hi).map((t, i) => (
              <G key={i}>
                <Line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} stroke={INK.grid} strokeWidth={1} />
                <SvgText x={PAD.l - 6} y={y(t) + 3.5} fontSize={10} fill={INK.muted} textAnchor="end">{percent ? `${Math.round(t)}%` : format(t, true)}</SvgText>
              </G>
            ))}
            {refLines.map((r, i) => r.y >= lo && r.y <= hi && (
              <G key={`r${i}`}>
                <Line x1={PAD.l} x2={width - PAD.r} y1={y(r.y)} y2={y(r.y)} stroke={INK.secondary} strokeWidth={1} strokeDasharray="4,4" />
              </G>
            ))}
            {labels.map((l, i) => {
              const show = i === n - 1 || (i % every === 0 && n - 1 - i >= every * 0.6);   // first, every few, and the last one
              return show ? (
                <SvgText key={`x${i}`} x={x(i)} y={height - 6} fontSize={10} fill={INK.muted} textAnchor={i === 0 && n > 1 ? "start" : i === n - 1 && n > 1 ? "end" : "middle"}>{_tx(l)}</SvgText>
              ) : null;
            })}
            {paths.map((d, k) => !!d && <Path key={k} d={d} stroke={series[k].color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />)}
            {series.map((sr, k) => sr.values.map((v, i) => {
              const alone = (v !== null && v !== undefined) && (i === 0 || sr.values[i - 1] == null) && (i === n - 1 || sr.values[i + 1] == null);
              return alone ? <Circle key={`d${k}-${i}`} cx={x(i)} cy={y(+v)} r={3.5} fill={sr.color} /> : null;
            }))}
            {refLines.map((r, i) => r.y >= lo && r.y <= hi && (
              <G key={`rl${i}`}>
                <Rect x={width - PAD.r - String(r.label).length * 5.4 - 6} y={y(r.y) - 14} width={String(r.label).length * 5.4 + 6} height={12} rx={3} fill={INK.surface} opacity={0.92} />
                <SvgText x={width - PAD.r - 3} y={y(r.y) - 4.5} fontSize={9.5} fill={INK.secondary} textAnchor="end">{_tx(r.label)}</SvgText>
              </G>
            ))}
            {idx !== null && (
              <G>
                <Line x1={x(idx)} x2={x(idx)} y1={PAD.t} y2={PAD.t + plotH} stroke={INK.secondary} strokeWidth={1} />
                {series.map((sr, k) => sr.values[idx] != null && (
                  <Circle key={`h${k}`} cx={x(idx)} cy={y(+sr.values[idx])} r={5} fill={sr.color} stroke={INK.surface} strokeWidth={2} />
                ))}
              </G>
            )}
          </Svg>
          {idx !== null && (
            <Tooltip x={x(idx)} width={width} title={_tx((titles ?? labels)[idx])}
              rows={series.map((sr) => ({ name: sr.name, color: series.length > 1 ? sr.color : null, value: sr.values[idx] == null ? "–" : format(+sr.values[idx]) }))} />
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Grouped bar chart (1–2 series) with an optional target marker per group.
 * series: [{ name, color, values }]; targets: [number|null]
 */
export function BarChart({ labels = [], titles, series = [], targets, height = 200, format = (v) => String(v), percent = false, targetName = "Target" }) {
  const [width, onLayout] = useWidth();
  const n = labels.length;
  const plotW = Math.max(1, width - PAD.l - PAD.r);
  const plotH = height - PAD.t - PAD.b;
  const gw = n ? plotW / n : plotW;
  const hi = useMemo(() => percent ? 100 : niceMax(Math.max(0, ...series.flatMap((x) => x.values.map((v) => +v || 0)), ...((targets ?? []).map((v) => +v || 0)))),
    [series, targets, percent]);
  const y = (v) => PAD.t + plotH - (Math.max(0, Math.min(hi, v)) / (hi || 1)) * plotH;
  const k = Math.max(1, series.length);
  const gap = 2;
  const bw = Math.max(3, Math.min(22, (gw * 0.72 - gap * (k - 1)) / k));
  const groupX = (i) => PAD.l + i * gw + (gw - (bw * k + gap * (k - 1))) / 2;
  const [idx, , touch] = useTouch(n, PAD.l + gw / 2, gw);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 34))));

  return (
    <View onLayout={onLayout} style={{ height }} accessible accessibilityLabel={_t("Bar chart, {v}", { v: series.map((x) => x.name).join(", ") })}>
      {width > 0 && (
        <View {...touch}>
          <Svg width={width} height={height}>
            {ticks(0, hi).map((t, i) => (
              <G key={i}>
                <Line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} stroke={INK.grid} strokeWidth={1} />
                <SvgText x={PAD.l - 6} y={y(t) + 3.5} fontSize={10} fill={INK.muted} textAnchor="end">{percent ? `${Math.round(t)}%` : format(t, true)}</SvgText>
              </G>
            ))}
            {idx !== null && <Rect x={PAD.l + idx * gw} y={PAD.t} width={gw} height={plotH} fill="#f1f5f9" />}
            {labels.map((l, i) => series.map((sr, j) => {
              const v = +sr.values[i] || 0;
              const top = y(v);
              return <Path key={`${i}-${j}`} d={barPath(groupX(i) + j * (bw + gap), top, bw, PAD.t + plotH - top)} fill={sr.color} />;
            }))}
            {(targets ?? []).map((t, i) => t != null && (
              <Line key={`t${i}`} x1={groupX(i) - 3} x2={groupX(i) + bw * k + gap * (k - 1) + 3} y1={y(+t)} y2={y(+t)} stroke={INK.primary} strokeWidth={2.5} strokeLinecap="round" />
            ))}
            <Line x1={PAD.l} x2={width - PAD.r} y1={PAD.t + plotH} y2={PAD.t + plotH} stroke={INK.axis} strokeWidth={1} />
            {labels.map((l, i) => i % every === 0 && (
              <SvgText key={`x${i}`} x={PAD.l + i * gw + gw / 2} y={height - 6} fontSize={10} fill={INK.muted} textAnchor="middle">{_tx(l)}</SvgText>
            ))}
          </Svg>
          {idx !== null && (
            <Tooltip x={PAD.l + idx * gw + gw / 2} width={width} title={_tx((titles ?? labels)[idx])}
              rows={[...series.map((sr) => ({ name: sr.name, color: sr.color, value: format(+sr.values[idx] || 0) })),
                ...((targets && targets[idx] != null) ? [{ name: targetName, color: INK.primary, dash: true, value: format(+targets[idx]) }] : [])]} />
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Ranked horizontal bars (built from Views – crisp text, easy tapping).
 * rows: [{ key, label, value (0–100 or amount), text, sub, onPress }]; ref: { value, label } (e.g. pass mark)
 */
export function HBars({ rows = [], max = 100, color = PALETTE.s1, ref, onPress }) {
  return (
    <View>
      {rows.map((r) => {
        const w = Math.max(0, Math.min(1, (+r.value || 0) / (max || 1)));
        return (
          <View key={r.key ?? r.label} style={s.hRow} onStartShouldSetResponder={() => !!(onPress || r.onPress)} onResponderRelease={() => (r.onPress ?? onPress)?.(r)}>
            <View style={s.hHead}>
              <Text style={s.hLabel} numberOfLines={1}>{_tx(r.label)}</Text>
              <Text style={s.hVal}>{_tx(r.text) ?? _tx(r.value)}</Text>
            </View>
            <View style={s.hTrack}>
              {r.value !== null && r.value !== undefined && <View style={[s.hFill, { width: `${w * 100}%`, backgroundColor: r.color ?? color }]} />}
              {ref && ref.value >= 0 && ref.value <= max && <View style={[s.hRef, { left: `${(ref.value / max) * 100}%` }]} />}
            </View>
            {!!r.sub && <Text style={s.hSub} numberOfLines={1}>{_tx(r.sub)}</Text>}
          </View>
        );
      })}
      {ref && rows.length > 0 && (
        <View style={s.hRefKey}><View style={s.hRefSwatch} /><Text style={s.hRefTxt}>{_tx(ref.label)}</Text></View>
      )}
    </View>
  );
}

/** Headline number tile. tone: good / warning / critical colours only the small icon dot. */
export function StatTile({ label, value, sub, tone, icon, style }) {
  const c = tone ? STATUS[tone] : null;
  return (
    <View style={[s.tile, style]}>
      <Text style={s.tileLabel} numberOfLines={1}>{_tx(label)}</Text>
      <Text style={s.tileValue} numberOfLines={1} adjustsFontSizeToFit>{_tx(value)}</Text>
      {!!sub && (
        <View style={s.tileSubRow}>
          {!!c && <View style={[s.tileDot, { backgroundColor: c }]} />}
          {!!icon && icon}
          <Text style={s.tileSub} numberOfLines={2}>{_tx(sub)}</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  tip: { position: "absolute", top: 4, backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: INK.grid, paddingVertical: 6, paddingHorizontal: 8,
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  tipTitle: { fontSize: 11, fontWeight: "800", color: INK.primary, marginBottom: 3 },
  tipRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  tipSwatch: { width: 8, height: 8, borderRadius: 2, marginRight: 5 },
  tipName: { flex: 1, fontSize: 11, color: INK.muted },
  tipVal: { fontSize: 11, fontWeight: "700", color: INK.primary, marginLeft: 6 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 6 },
  legendItem: { flexDirection: "row", alignItems: "center" },
  legendBox: { width: 10, height: 10, borderRadius: 2, marginRight: 5 },
  legendLine: { width: 14, height: 2, borderRadius: 1, marginRight: 5 },
  legendDash: { width: 12, height: 3, borderRadius: 1, marginRight: 5 },
  legendTxt: { fontSize: 11.5, color: INK.secondary },
  hRow: { marginBottom: 10 },
  hHead: { flexDirection: "row", alignItems: "baseline", marginBottom: 4 },
  hLabel: { flex: 1, fontSize: 12.5, fontWeight: "600", color: INK.primary },
  hVal: { fontSize: 12.5, fontWeight: "700", color: INK.primary, marginLeft: 8 },
  hTrack: { height: 10, backgroundColor: "#f1f5f9", borderRadius: 5, overflow: "visible", justifyContent: "center" },
  hFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 5 },
  hRef: { position: "absolute", top: -3, bottom: -3, width: 2, marginLeft: -1, backgroundColor: INK.primary, borderRadius: 1 },
  hSub: { fontSize: 11, color: INK.muted, marginTop: 3 },
  hRefKey: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  hRefSwatch: { width: 2, height: 12, backgroundColor: INK.primary, marginRight: 6 },
  hRefTxt: { fontSize: 11, color: INK.muted },
  tile: { flexGrow: 1, flexBasis: "45%", backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: INK.grid, padding: 12 },
  tileLabel: { fontSize: 11.5, color: INK.muted, fontWeight: "600" },
  tileValue: { fontSize: 22, fontWeight: "800", color: INK.primary, marginTop: 4 },
  tileSubRow: { flexDirection: "row", alignItems: "center", marginTop: 4, gap: 5 },
  tileDot: { width: 8, height: 8, borderRadius: 4 },
  tileSub: { flex: 1, fontSize: 11, color: INK.secondary },
});
