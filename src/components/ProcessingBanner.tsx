/**
 * ProcessingBanner.tsx
 *
 * Persistent capture-queue status banner rendered above the system navigation bar.
 *
 * Collapsed pill (always visible when queue is non-empty):
 *   ● Processing 2 items · Metadata…  ██░░ 45%
 *
 * Expanded panel (tap pill to toggle):
 *   ┌──────────────────────────────────────────┐
 *   │ Queued: 1   Processing: 1   Done: 2      │
 *   ├──────────────────────────────────────────┤
 *   │ ● youtube.com   Metadata… ●●●○○○○○       │
 *   │ ✓ instagram.com Done       ●●●●●●●●       │
 *   └──────────────────────────────────────────┘
 *
 * Completion toast (auto-dismisses after 3 s):
 *   ✅ Saved and analyzed
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator as PaperActivityIndicator } from 'react-native-paper';
import { useCaptureQueue } from '../context/CaptureQueueContext';
import { getExactSourceLabel } from '../services/metadata';
import { useAppTheme } from '../constants/colors';
import { useTheme } from '../context/ThemeContext';
import type { CaptureEntry, EnrichmentStep } from '../services/captureQueue';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_LABELS: Record<EnrichmentStep, string> = {
  source:      'Source',
  thumbnail:   'Thumbnail',
  metadata:    'Metadata',
  ai_summary:  'AI Summary',
  tags:        'Tags',
  category:    'Category',
  collections: 'Collections',
  location:    'Location',
};

const ALL_STEPS: EnrichmentStep[] = [
  'source', 'thumbnail', 'metadata', 'ai_summary', 'tags', 'category', 'collections', 'location',
];
const TOTAL_STEPS = ALL_STEPS.length;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Overall progress 0–100 across all queue entries. */
function calcOverallProgress(queue: CaptureEntry[]): number {
  if (queue.length === 0) return 0;
  let totalSteps = 0;
  let doneSteps = 0;
  for (const e of queue) {
    if (e.status === 'completed') {
      totalSteps += TOTAL_STEPS;
      doneSteps += TOTAL_STEPS;
    } else if (e.status === 'failed') {
      totalSteps += TOTAL_STEPS;
      doneSteps += e.completedSteps.length;
    } else {
      totalSteps += TOTAL_STEPS;
      doneSteps += e.completedSteps.length;
    }
  }
  return totalSteps === 0 ? 0 : Math.round((doneSteps / totalSteps) * 100);
}

/** Current step label from the first actively-processing entry. */
function currentStepLabel(queue: CaptureEntry[]): string | null {
  const active = queue.find((e) => e.status === 'processing' && e.currentStep);
  return active?.currentStep ? STEP_LABELS[active.currentStep] : null;
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  const widthAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: pct,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [pct]); // eslint-disable-line -- widthAnim is a stable Animated.Value ref

  return (
    <View style={pbStyles.track}>
      <Animated.View
        style={[
          pbStyles.fill,
          {
            backgroundColor: color,
            width: widthAnim.interpolate({
              inputRange: [0, 100],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}
      />
    </View>
  );
}

const pbStyles = StyleSheet.create({
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    flex: 1,
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
});

// ─── Single queue row ─────────────────────────────────────────────────────────

function QueueRow({ entry }: { entry: CaptureEntry }) {
  const paper = useAppTheme();
  const { colors } = useTheme();

  // Priority for row label:
  //   1. AI-generated title (set after enrichment)
  //   2. User-provided title hint (e.g. from share text)
  //   3. Exact source label set synchronously on enqueue ("Instagram Reel", "YouTube Video")
  //   4. Hostname fallback
  const displayLabel =
    entry.displayTitle ||
    (entry.titleHint && !entry.titleHint.startsWith('http') ? entry.titleHint : null) ||
    entry.sourceLabel ||
    getExactSourceLabel(undefined, undefined, entry.url);

  const statusColor =
    entry.status === 'completed' ? colors.success :
    entry.status === 'failed'    ? paper.colors.error :
    paper.colors.primary;

  const statusIcon: React.ComponentProps<typeof Ionicons>['name'] =
    entry.status === 'completed' ? 'checkmark-circle' :
    entry.status === 'failed'    ? 'alert-circle'     :
    'time-outline';

  const itemPct = entry.status === 'completed'
    ? 100
    : Math.round((entry.completedSteps.length / TOTAL_STEPS) * 100);

  return (
    <View style={[rowStyles.row, { borderBottomColor: colors.border }]}>
      {/* Status icon / spinner */}
      <View style={rowStyles.iconCol}>
        {entry.status === 'processing' ? (
          <PaperActivityIndicator size={16} color={statusColor} />
        ) : (
          <Ionicons name={statusIcon} size={16} color={statusColor} />
        )}
      </View>

      {/* Domain + step + progress */}
      <View style={rowStyles.textCol}>
        <View style={rowStyles.topRow}>
          <Text style={[rowStyles.hostname, { color: colors.text }]} numberOfLines={1}>{displayLabel}</Text>
          <Text style={[rowStyles.pct, { color: statusColor }]}>{itemPct}%</Text>
        </View>
        {entry.status === 'processing' && entry.currentStep && (
          <Text style={[rowStyles.step, { color: colors.textMuted }]}>
            {STEP_LABELS[entry.currentStep]}…
          </Text>
        )}
        {entry.status === 'queued' && (
          <Text style={[rowStyles.step, { color: colors.textMuted }]}>Queued</Text>
        )}
        {entry.status === 'completed' && (
          <Text style={[rowStyles.step, { color: colors.success }]}>Done</Text>
        )}
        {entry.status === 'failed' && (
          <Text style={[rowStyles.step, { color: paper.colors.error }]} numberOfLines={1}>
            {entry.error ?? 'Failed'}
          </Text>
        )}
        {/* Step dots */}
        <View style={rowStyles.dotsRow}>
          {ALL_STEPS.map((step) => {
            const done = entry.completedSteps.includes(step);
            const active = entry.currentStep === step;
            return (
              <View
                key={step}
                style={[
                  rowStyles.dot,
                  {
                    backgroundColor: done
                      ? statusColor
                      : active
                      ? statusColor + '66'
                      : colors.border,
                  },
                ]}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  iconCol: { width: 20, alignItems: 'center', paddingTop: 2 },
  textCol: { flex: 1, gap: 3 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hostname: { fontSize: 13, fontWeight: '600', flex: 1 },
  pct: { fontSize: 12, fontWeight: '700', marginLeft: 8 },
  step: { fontSize: 11 },
  dotsRow: { flexDirection: 'row', gap: 3, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
});

// ─── Completion toast ─────────────────────────────────────────────────────────

function CompletionToast({ onDone }: { onDone: () => void }) {
  const paper = useAppTheme();
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    // Fade in
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, tension: 100, friction: 10, useNativeDriver: true }),
    ]).start();

    // Auto-dismiss after 3 s
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -8, duration: 300, useNativeDriver: true }),
      ]).start(onDone);
    }, 3000);

    return () => clearTimeout(timer);
  }, []); // eslint-disable-line -- animation runs once on mount; refs are stable

  return (
    <Animated.View
      style={[
        toastStyles.toast,
        {
          backgroundColor: colors.success + 'EE',
          transform: [{ translateY }],
          opacity,
        },
      ]}
      pointerEvents="none"
    >
      <Ionicons name="checkmark-circle" size={16} color="#fff" />
      <Text style={toastStyles.text}>Saved and analyzed</Text>
    </Animated.View>
  );
}

const toastStyles = StyleSheet.create({
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 24,
    marginBottom: 6,
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});

// ─── Main banner ──────────────────────────────────────────────────────────────

export function ProcessingBanner() {
  const { queue, activeCount, completedCount, failedCount, clearFinished } = useCaptureQueue();
  const paper = useAppTheme();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  const [showToast, setShowToast] = useState(false);

  // Stable ref so timer callbacks always call the current clearFinished without
  // being listed as a timer effect dependency (which would reset the timer on
  // every re-render during enrichment).
  const clearFinishedRef = useRef(clearFinished);
  useEffect(() => { clearFinishedRef.current = clearFinished; });

  // Track previous activeCount to detect the transition to 0 (all done)
  const prevActiveCountRef = useRef(activeCount);

  useEffect(() => {
    // Show toast when the last active item finishes and we had items in flight
    const justFinished =
      prevActiveCountRef.current > 0 &&
      activeCount === 0 &&
      completedCount > 0 &&
      queue.length > 0;
    if (justFinished) {
      setShowToast(true);
      // Auto-collapse immediately when all tasks complete
      setExpanded(false);
    }
    prevActiveCountRef.current = activeCount;
  }, [activeCount, completedCount, queue.length]);

  // Auto-hide completed queue entries after a delay.
  // Only starts the timer when ALL items are done (activeCount === 0) so it
  // cannot fire while new items are still processing.
  // clearFinished is accessed via ref so this effect does NOT reset when the
  // function reference changes — only when the queue state changes.
  useEffect(() => {
    if (activeCount === 0 && completedCount > 0 && queue.length > 0) {
      const timer = setTimeout(() => {
        clearFinishedRef.current();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [activeCount, completedCount, queue.length]); // intentionally omits clearFinished

  // Animated height for expand/collapse
  const expandAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(expandAnim, {
      toValue: expanded ? 1 : 0,
      tension: 90,
      friction: 12,
      useNativeDriver: false,
    }).start();
  }, [expanded]); // eslint-disable-line -- expandAnim is a stable Animated.Value ref

  // Auto-collapse when queue empties
  useEffect(() => {
    if (queue.length === 0) setExpanded(false);
  }, [queue.length]);

  if (queue.length === 0 && !showToast) return null;

  const overallPct = calcOverallProgress(queue);
  const stepLabel = currentStepLabel(queue);
  const queuedCount = queue.filter((e) => e.status === 'queued').length;
  const processingCount = queue.filter((e) => e.status === 'processing').length;

  const maxExpandedHeight = Math.min(queue.length * 68 + 52, 320);
  const expandedHeight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, maxExpandedHeight],
  });

  const pillColor = activeCount > 0
    ? paper.colors.primary
    : failedCount > 0
    ? paper.colors.error
    : colors.success;

  const pillLabel =
    activeCount > 0
      ? `Processing ${activeCount} item${activeCount !== 1 ? 's' : ''}`
      : completedCount > 0 && failedCount === 0
      ? `${completedCount} item${completedCount !== 1 ? 's' : ''} ready`
      : failedCount > 0
      ? `${failedCount} failed`
      : 'Queue';

  const allDone = activeCount === 0;

  return (
    <View
      style={[
        bannerStyles.container,
        {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          paddingBottom: insets.bottom > 0 ? 0 : 4,
        },
      ]}
      pointerEvents="box-none"
    >
      {/* Completion toast — floats above the pill */}
      {showToast && <CompletionToast onDone={() => setShowToast(false)} />}

      {/* Expanded entry list */}
      {queue.length > 0 && (
        <Animated.View style={{ height: expandedHeight, overflow: 'hidden' }}>
          {/* Summary stats row */}
          <View style={[bannerStyles.statsRow, { borderBottomColor: colors.border }]}>
            <Text style={[bannerStyles.statItem, { color: colors.textMuted }]}>
              <Text style={{ fontWeight: '700', color: paper.colors.primary }}>{queuedCount}</Text> Queued
            </Text>
            <Text style={[bannerStyles.statItem, { color: colors.textMuted }]}>
              <Text style={{ fontWeight: '700', color: paper.colors.secondary }}>{processingCount}</Text> Processing
            </Text>
            <Text style={[bannerStyles.statItem, { color: colors.textMuted }]}>
              <Text style={{ fontWeight: '700', color: colors.success }}>{completedCount}</Text> Done
            </Text>
          </View>
          {/* Per-item rows */}
          <ScrollView
            style={{ flex: 1 }}
            scrollEnabled={expanded}
            showsVerticalScrollIndicator={false}
          >
            {queue.map((entry) => (
              <QueueRow key={entry.itemId} entry={entry} />
            ))}
          </ScrollView>
        </Animated.View>
      )}

      {/* Collapsed pill bar */}
      {queue.length > 0 && (
        <View style={bannerStyles.pillBar}>
          <TouchableOpacity
            onPress={() => setExpanded((v) => !v)}
            style={[bannerStyles.pill, { backgroundColor: pillColor + '18', borderColor: pillColor + '44' }]}
            accessibilityRole="button"
            accessibilityLabel={pillLabel}
          >
            {/* Left: spinner or icon */}
            {activeCount > 0 ? (
              <PaperActivityIndicator size={12} color={pillColor} />
            ) : (
              <Ionicons
                name={failedCount > 0 ? 'alert-circle' : 'checkmark-circle'}
                size={14}
                color={pillColor}
              />
            )}

            {/* Label + step */}
            <View style={bannerStyles.pillTextBlock}>
              <Text style={[bannerStyles.pillLabel, { color: pillColor }]} numberOfLines={1}>
                {pillLabel}
                {stepLabel && activeCount > 0 ? ` · ${stepLabel}…` : ''}
              </Text>
            </View>

            {/* Progress bar + pct (only while active) */}
            {activeCount > 0 && (
              <View style={bannerStyles.progressBlock}>
                <ProgressBar pct={overallPct} color={pillColor} />
                <Text style={[bannerStyles.pctText, { color: pillColor }]}>{overallPct}%</Text>
              </View>
            )}

            <Ionicons
              name={expanded ? 'chevron-down' : 'chevron-up'}
              size={12}
              color={pillColor}
            />
          </TouchableOpacity>

          {/* Dismiss — only when all done */}
          {allDone && (
            <TouchableOpacity
              onPress={clearFinished}
              style={bannerStyles.dismissBtn}
              accessibilityRole="button"
              accessibilityLabel="Dismiss queue"
            >
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statItem: {
    fontSize: 12,
  },
  pillBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    flex: 1,
  },
  pillTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  pillLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  progressBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    width: 80,
  },
  pctText: {
    fontSize: 11,
    fontWeight: '700',
    minWidth: 30,
    textAlign: 'right',
  },
  dismissBtn: {
    padding: 6,
  },
});
