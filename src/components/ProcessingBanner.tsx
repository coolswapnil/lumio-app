/**
 * ProcessingBanner.tsx
 *
 * Persistent capture-queue status banner rendered above the system navigation bar.
 *
 * Collapsed bar (48–56dp, always visible when queue is active):
 *   ⟳  Processing 2 Items
 *      Instagram Reel · 72%
 *      ████████░░
 *
 * Expanded panel (tap bar to toggle):
 *   Processing Queue
 *   2 Queued   1 Processing   8 Completed
 *   ────────────────────────────────────
 *   ⟳ Instagram Reel
 *     Generating AI Summary · 72%
 *     ████████░░
 *   ────────────────────────────────────
 *   ⏳ YouTube Video  Queued
 *   ────────────────────────────────────
 *   ✓ LinkedIn Post   Done
 *   ────────────────────────────────────
 *
 * Completion toast (auto-dismisses after 3 s):
 *   ✅ Saved and Analyzed   [View]
 */

import React, { useState, useRef, useEffect } from 'react';
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
import { useRouter } from 'expo-router';
import { useCaptureQueue } from '../context/CaptureQueueContext';
import { getExactSourceLabel } from '../services/metadata';
import { useAppTheme } from '../constants/colors';
import { useTheme } from '../context/ThemeContext';
import type { CaptureEntry, EnrichmentStep } from '../services/captureQueue';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_LABELS: Record<EnrichmentStep, string> = {
  source:      'Fetching Source',
  thumbnail:   'Loading Thumbnail',
  metadata:    'Reading Metadata',
  ai_summary:  'Generating AI Summary',
  tags:        'Generating Tags',
  category:    'Categorizing',
  collections: 'Assigning Collection',
  location:    'Detecting Location',
};

const ALL_STEPS: EnrichmentStep[] = [
  'source', 'thumbnail', 'metadata', 'ai_summary', 'tags', 'category', 'collections', 'location',
];
const TOTAL_STEPS = ALL_STEPS.length;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Overall progress 0–100 across all active+queued entries only (not completed). */
function calcOverallProgress(queue: CaptureEntry[]): number {
  if (queue.length === 0) return 0;
  let totalSteps = 0;
  let doneSteps = 0;
  for (const e of queue) {
    if (e.status === 'completed') {
      totalSteps += TOTAL_STEPS;
      doneSteps += TOTAL_STEPS;
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

/** Display label for the first actively-processing entry. */
function currentItemLabel(queue: CaptureEntry[]): string | null {
  const active = queue.find((e) => e.status === 'processing');
  if (!active) return null;
  return (
    active.displayTitle ||
    (active.titleHint && !active.titleHint.startsWith('http') ? active.titleHint : null) ||
    active.sourceLabel ||
    getExactSourceLabel(undefined, undefined, active.url)
  );
}

/** Per-item progress 0–100. */
function itemProgress(entry: CaptureEntry): number {
  if (entry.status === 'completed') return 100;
  return Math.round((entry.completedSteps.length / TOTAL_STEPS) * 100);
}

/** Human-readable label for a queue entry. */
function entryLabel(entry: CaptureEntry): string {
  return (
    entry.displayTitle ||
    (entry.titleHint && !entry.titleHint.startsWith('http') ? entry.titleHint : null) ||
    entry.sourceLabel ||
    getExactSourceLabel(undefined, undefined, entry.url)
  );
}

// ─── Animated progress bar ────────────────────────────────────────────────────

function ProgressBar({ pct, color, height = 4 }: { pct: number; color: string; height?: number }) {
  const widthAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: pct,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [pct]); // eslint-disable-line

  return (
    <View style={[pbStyles.track, { height }]}>
      <Animated.View
        style={[
          pbStyles.fill,
          {
            backgroundColor: color,
            height,
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
    borderRadius: 3,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    flex: 1,
  },
  fill: {
    borderRadius: 3,
  },
});

// ─── Single queue row (expanded list) ────────────────────────────────────────

function QueueRow({ entry }: { entry: CaptureEntry }) {
  const paper = useAppTheme();
  const { colors } = useTheme();

  const label = entryLabel(entry);
  const pct = itemProgress(entry);

  const statusColor =
    entry.status === 'completed' ? colors.success :
    entry.status === 'failed'    ? paper.colors.error :
    paper.colors.primary;

  const statusIcon: React.ComponentProps<typeof Ionicons>['name'] =
    entry.status === 'completed' ? 'checkmark-circle' :
    entry.status === 'failed'    ? 'alert-circle'     :
    entry.status === 'queued'    ? 'time-outline'      :
    'ellipsis-horizontal-circle-outline';

  const stepText =
    entry.status === 'processing' && entry.currentStep
      ? STEP_LABELS[entry.currentStep]
      : entry.status === 'queued'
      ? 'Queued'
      : entry.status === 'completed'
      ? 'Done'
      : entry.error ?? 'Failed';

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

      {/* Content */}
      <View style={rowStyles.textCol}>
        <View style={rowStyles.topRow}>
          <Text style={[rowStyles.label, { color: colors.text }]} numberOfLines={1}>{label}</Text>
          {entry.status === 'processing' && (
            <Text style={[rowStyles.pct, { color: statusColor }]}>{pct}%</Text>
          )}
        </View>

        <Text style={[rowStyles.step, { color: entry.status === 'failed' ? paper.colors.error : colors.textMuted }]} numberOfLines={1}>
          {stepText}
        </Text>

        {entry.status === 'processing' && (
          <View style={rowStyles.barRow}>
            <ProgressBar pct={pct} color={statusColor} height={3} />
          </View>
        )}
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  iconCol: { width: 20, alignItems: 'center', paddingTop: 2 },
  textCol: { flex: 1, gap: 3 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 13, fontWeight: '600', flex: 1 },
  pct: { fontSize: 12, fontWeight: '700', marginLeft: 8 },
  step: { fontSize: 11 },
  barRow: { marginTop: 3 },
});

// ─── Completion toast ─────────────────────────────────────────────────────────

function CompletionToast({ lastItemId, onDone }: { lastItemId?: string; onDone: () => void }) {
  const paper = useAppTheme();
  const { colors } = useTheme();
  const router = useRouter();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;
  const dismissed = useRef(false);

  const dismiss = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -8, duration: 250, useNativeDriver: true }),
    ]).start(onDone);
  };

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, tension: 100, friction: 10, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(dismiss, 3000);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line

  const handleView = () => {
    dismiss();
    if (lastItemId) {
      setTimeout(() => router.push(`/item/${lastItemId}`), 280);
    }
  };

  return (
    <Animated.View
      style={[
        toastStyles.toast,
        {
          backgroundColor: colors.success,
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <Ionicons name="checkmark-circle" size={16} color="#fff" />
      <Text style={toastStyles.text}>Saved and Analyzed</Text>
      <View style={toastStyles.spacer} />
      {lastItemId && (
        <TouchableOpacity
          onPress={handleView}
          style={[toastStyles.viewBtn, { borderColor: 'rgba(255,255,255,0.5)' }]}
          accessibilityRole="button"
          accessibilityLabel="View saved item"
        >
          <Text style={toastStyles.viewBtnText}>View</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const toastStyles = StyleSheet.create({
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 24,
    marginBottom: 6,
    marginHorizontal: 16,
    minWidth: 220,
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  spacer: { flex: 1 },
  viewBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  viewBtnText: {
    color: '#fff',
    fontSize: 12,
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
  const [lastCompletedId, setLastCompletedId] = useState<string | undefined>();

  // Stable ref so timer callbacks always call the current clearFinished
  const clearFinishedRef = useRef(clearFinished);
  useEffect(() => { clearFinishedRef.current = clearFinished; });

  // Track previous activeCount to detect the transition to 0 (all done)
  const prevActiveCountRef = useRef(activeCount);
  // Track previous queue length to detect new item arrivals
  const prevQueueLengthRef = useRef(queue.length);
  // Ref for the auto-collapse timer so we can cancel it if the user taps
  const autoCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const justFinished =
      prevActiveCountRef.current > 0 &&
      activeCount === 0 &&
      completedCount > 0 &&
      queue.length > 0;
    if (justFinished) {
      // Capture the last completed item id for the View button
      const last = queue.filter((e) => e.status === 'completed').pop();
      setLastCompletedId(last?.itemId);
      setShowToast(true);
      setExpanded(false);
    }
    prevActiveCountRef.current = activeCount;
  }, [activeCount, completedCount, queue.length]); // eslint-disable-line

  // FIX 6: Auto-expand for 2 s when a new item arrives in the queue
  useEffect(() => {
    const newItemArrived = queue.length > prevQueueLengthRef.current && activeCount > 0;
    prevQueueLengthRef.current = queue.length;

    if (newItemArrived) {
      // Cancel any pending auto-collapse before starting a fresh one
      if (autoCollapseTimerRef.current) clearTimeout(autoCollapseTimerRef.current);
      setExpanded(true);
      autoCollapseTimerRef.current = setTimeout(() => {
        setExpanded(false);
        autoCollapseTimerRef.current = null;
      }, 2000);
    }
    return () => {
      if (autoCollapseTimerRef.current) {
        clearTimeout(autoCollapseTimerRef.current);
        autoCollapseTimerRef.current = null;
      }
    };
  }, [queue.length, activeCount]); // eslint-disable-line

  // Auto-hide completed queue entries after a delay
  useEffect(() => {
    if (activeCount === 0 && completedCount > 0 && queue.length > 0) {
      const timer = setTimeout(() => { clearFinishedRef.current(); }, 4000);
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
  }, [expanded]); // eslint-disable-line

  // Auto-collapse when queue empties
  useEffect(() => {
    if (queue.length === 0) setExpanded(false);
  }, [queue.length]);

  if (queue.length === 0 && !showToast) return null;

  const overallPct = calcOverallProgress(queue);
  const stepLabel  = currentStepLabel(queue);
  const itemLabel  = currentItemLabel(queue);
  const queuedCount    = queue.filter((e) => e.status === 'queued').length;
  const processingCount = queue.filter((e) => e.status === 'processing').length;

  const maxExpandedHeight = Math.min(queue.length * 68 + 80, 360);
  const expandedHeight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, maxExpandedHeight],
  });

  const accentColor = activeCount > 0
    ? paper.colors.primary
    : failedCount > 0
    ? paper.colors.error
    : colors.success;

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
      {/* Completion toast — floats above the collapsed bar */}
      {showToast && (
        <CompletionToast
          lastItemId={lastCompletedId}
          onDone={() => setShowToast(false)}
        />
      )}

      {/* ── Expanded panel ───────────────────────────────────────────────── */}
      {queue.length > 0 && (
        <Animated.View style={[bannerStyles.expandedPanel, { height: expandedHeight, borderBottomColor: colors.border }]}>
          {/* Header: Processing Queue + counts */}
          <View style={[bannerStyles.expandedHeader, { borderBottomColor: colors.border }]}>
            <Text style={[bannerStyles.expandedTitle, { color: colors.text }]}>Processing Queue</Text>
            <View style={bannerStyles.countRow}>
              <CountBadge value={queuedCount}    label="Queued"     color={paper.colors.onSurfaceVariant} bg={colors.border} />
              <CountBadge value={processingCount} label="Processing" color={paper.colors.primary}          bg={paper.colors.primaryContainer} />
              <CountBadge value={completedCount}  label="Done"       color={colors.success}                bg={colors.success + '22'} />
            </View>
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

      {/* ── Collapsed bar (48–56dp) ───────────────────────────────────────── */}
      {queue.length > 0 && (
        <TouchableOpacity
          onPress={() => setExpanded((v) => !v)}
          style={[
            bannerStyles.collapsedBar,
            {
              backgroundColor: accentColor + '10',
              borderColor: accentColor + '30',
              minHeight: 48,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Processing queue. ${activeCount} active, ${completedCount} done. Tap to ${expanded ? 'collapse' : 'expand'}.`}
          activeOpacity={0.85}
        >
          {/* Left: spinner or status icon */}
          <View style={bannerStyles.barIconCol}>
            {activeCount > 0 ? (
              <PaperActivityIndicator size={18} color={accentColor} />
            ) : (
              <Ionicons
                name={failedCount > 0 ? 'alert-circle' : 'checkmark-circle'}
                size={20}
                color={accentColor}
              />
            )}
          </View>

          {/* Centre: primary label + item/step sub-line + progress bar */}
          <View style={bannerStyles.barBody}>
            {/* Primary status label */}
            <View style={bannerStyles.barTopRow}>
              <Text style={[bannerStyles.barTitle, { color: accentColor }]} numberOfLines={1}>
                {activeCount > 0
                  ? `Processing ${activeCount} Item${activeCount !== 1 ? 's' : ''}`
                  : completedCount > 0 && failedCount === 0
                  ? `${completedCount} Item${completedCount !== 1 ? 's' : ''} Ready`
                  : failedCount > 0
                  ? `${failedCount} Failed`
                  : 'Queue'}
              </Text>
              {activeCount > 0 && (
                <Text style={[bannerStyles.barPct, { color: accentColor }]}>{overallPct}%</Text>
              )}
            </View>

            {/* Item + step sub-line (only while active) */}
            {activeCount > 0 && (
              <Text style={[bannerStyles.barSub, { color: accentColor + 'BB' }]} numberOfLines={1}>
                {[itemLabel, stepLabel].filter(Boolean).join(' · ')}
              </Text>
            )}

            {/* Progress bar */}
            {activeCount > 0 && (
              <View style={bannerStyles.barProgressRow}>
                <ProgressBar pct={overallPct} color={accentColor} height={4} />
              </View>
            )}
          </View>

          {/* Right: expand/dismiss controls */}
          <View style={bannerStyles.barRight}>
            {allDone ? (
              <TouchableOpacity
                onPress={clearFinished}
                style={bannerStyles.dismissBtn}
                accessibilityRole="button"
                accessibilityLabel="Dismiss queue"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ) : (
              <Ionicons
                name={expanded ? 'chevron-down' : 'chevron-up'}
                size={14}
                color={accentColor}
              />
            )}
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Count badge sub-component ────────────────────────────────────────────────

function CountBadge({ value, label, color, bg }: { value: number; label: string; color: string; bg: string }) {
  return (
    <View style={[countStyles.badge, { backgroundColor: bg }]}>
      <Text style={[countStyles.num, { color }]}>{value}</Text>
      <Text style={[countStyles.lbl, { color }]}>{label}</Text>
    </View>
  );
}

const countStyles = StyleSheet.create({
  badge: { alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, minWidth: 52 },
  num:   { fontSize: 15, fontWeight: '800' },
  lbl:   { fontSize: 10, fontWeight: '600', marginTop: 1 },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const bannerStyles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // ── Expanded panel
  expandedPanel: {
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  expandedHeader: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  expandedTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  countRow: {
    flexDirection: 'row',
    gap: 6,
  },
  // ── Collapsed bar
  collapsedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    marginHorizontal: 12,
    marginVertical: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  barIconCol: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barBody: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  barTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barTitle: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  barPct: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  barSub: {
    fontSize: 11,
    fontWeight: '500',
  },
  barProgressRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  barRight: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
  },
  dismissBtn: {
    padding: 2,
  },
});
