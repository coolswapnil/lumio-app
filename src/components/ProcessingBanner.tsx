/**
 * ProcessingBanner.tsx
 *
 * A persistent, expandable banner that shows the capture queue state.
 * Rendered at the root level (above the tab bar) so it is visible
 * across all screens while enrichment is running.
 *
 * Collapsed:  "Processing 2 items  ▼"  (single pill, tappable)
 * Expanded:   list of queue entries with per-item status
 *
 * Dismisses automatically when all items complete/fail and the user
 * taps the dismiss button.
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
import { useCaptureQueue } from '../context/CaptureQueueContext';
import { useAppTheme } from '../constants/colors';
import { useTheme } from '../context/ThemeContext';
import type { CaptureEntry, EnrichmentStep } from '../services/captureQueue';

// ─── Step labels ─────────────────────────────────────────────────────────────

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

// ─── Single queue row ─────────────────────────────────────────────────────────

function QueueRow({ entry }: { entry: CaptureEntry }) {
  const paper = useAppTheme();
  const { colors } = useTheme();

  let hostname = entry.url;
  try { hostname = new URL(entry.url).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }

  const statusColor =
    entry.status === 'completed' ? colors.success :
    entry.status === 'failed'    ? paper.colors.error :
    paper.colors.primary;

  const statusIcon: React.ComponentProps<typeof Ionicons>['name'] =
    entry.status === 'completed' ? 'checkmark-circle' :
    entry.status === 'failed'    ? 'alert-circle'     :
    'time-outline';

  const stepProgress = ALL_STEPS.indexOf(entry.currentStep ?? 'source');
  const totalDone = entry.completedSteps.length;

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

      {/* Domain + step info */}
      <View style={rowStyles.textCol}>
        <Text style={[rowStyles.hostname, { color: colors.text }]} numberOfLines={1}>{hostname}</Text>
        {entry.status === 'processing' && entry.currentStep && (
          <Text style={[rowStyles.step, { color: colors.textMuted }]}>
            {STEP_LABELS[entry.currentStep]}… ({totalDone}/{ALL_STEPS.length})
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
      </View>

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
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  iconCol: { width: 20, alignItems: 'center' },
  textCol: { flex: 1, gap: 2 },
  hostname: { fontSize: 13, fontWeight: '600' },
  step: { fontSize: 11 },
  dotsRow: { flexDirection: 'row', gap: 3 },
  dot: { width: 5, height: 5, borderRadius: 3 },
});

// ─── Main banner ──────────────────────────────────────────────────────────────

export function ProcessingBanner() {
  const { queue, activeCount, completedCount, failedCount, clearFinished } = useCaptureQueue();
  const paper = useAppTheme();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);

  // Animated height for expand/collapse
  const expandAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(expandAnim, {
      toValue: expanded ? 1 : 0,
      tension: 90,
      friction: 12,
      useNativeDriver: false,
    }).start();
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-collapse when queue goes empty
  useEffect(() => {
    if (queue.length === 0) setExpanded(false);
  }, [queue.length]);

  // Don't render when queue is empty and nothing to show
  if (queue.length === 0) return null;

  const maxExpandedHeight = Math.min(queue.length * 56 + 16, 280);
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
      {/* Expanded entry list */}
      <Animated.View style={{ height: expandedHeight, overflow: 'hidden' }}>
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

      {/* Collapsed pill bar */}
      <View style={bannerStyles.pillBar}>
        <TouchableOpacity
          onPress={() => setExpanded((v) => !v)}
          style={[bannerStyles.pill, { backgroundColor: pillColor + '18', borderColor: pillColor + '44' }]}
          accessibilityRole="button"
          accessibilityLabel={pillLabel}
        >
          {activeCount > 0 ? (
            <PaperActivityIndicator size={12} color={pillColor} />
          ) : (
            <Ionicons
              name={failedCount > 0 ? 'alert-circle' : 'checkmark-circle'}
              size={14}
              color={pillColor}
            />
          )}
          <Text style={[bannerStyles.pillLabel, { color: pillColor }]}>{pillLabel}</Text>
          <Ionicons
            name={expanded ? 'chevron-down' : 'chevron-up'}
            size={12}
            color={pillColor}
          />
        </TouchableOpacity>

        {/* Dismiss button — only shown when all done */}
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
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
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
  pillLabel: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  dismissBtn: {
    padding: 6,
  },
});
