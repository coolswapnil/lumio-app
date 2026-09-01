import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional custom fallback. If omitted, the default error screen is shown. */
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * App-level ErrorBoundary.
 * Catches any unhandled JS exception in the tree below and renders a
 * recovery screen instead of a blank/crashed app.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <AppContent />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });
    // Log to console in dev; in production wire this to Sentry/Bugsnag:
    // Sentry.captureException(error, { contexts: { react: errorInfo } });
    console.error('[ErrorBoundary] Unhandled error:', error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <View style={styles.container}>
        <Surface style={styles.card} elevation={2}>
          <Text variant="headlineSmall" style={styles.title}>
            Something went wrong
          </Text>
          <Text variant="bodyMedium" style={styles.message}>
            An unexpected error occurred. Your saved data is safe.
          </Text>

          {__DEV__ && this.state.error && (
            <ScrollView style={styles.devBox}>
              <Text variant="bodySmall" style={styles.devText}>
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack}
              </Text>
            </ScrollView>
          )}

          <Button
            mode="contained"
            onPress={this.handleReset}
            style={styles.button}
            contentStyle={styles.buttonContent}
          >
            Try Again
          </Button>
        </Surface>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F9F9FF',
  },
  card: {
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 480,
    gap: 16,
  },
  title: {
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
    opacity: 0.7,
  },
  devBox: {
    maxHeight: 200,
    backgroundColor: '#1a1b20',
    borderRadius: 8,
    padding: 12,
  },
  devText: {
    color: '#ff6b6b',
    fontFamily: 'monospace',
    fontSize: 11,
  },
  button: {
    marginTop: 8,
    borderRadius: 12,
  },
  buttonContent: {
    paddingVertical: 4,
  },
});
