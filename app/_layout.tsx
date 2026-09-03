import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '../src/context/ThemeContext';
import { DataProvider } from '../src/context/DataContext';
import { SyncProvider } from '../src/context/SyncContext';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

function AppContent() {
  const { isDark, colors, settings } = useTheme();

  return (
    // SafeAreaProvider must wrap all useSafeAreaInsets() consumers.
    // Without it, insets default to 0 on Android — causing FABs and
    // scrollable content to render behind the navigation bar.
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
        {/*
          translucent={true} makes the status bar fully transparent so the
          app background draws behind it. Combined with the transparent
          navigationBarColor in styles.xml this gives true edge-to-edge.
        */}
        <StatusBar
          style={isDark ? 'light' : 'dark'}
          translucent={settings.edgeToEdge}
          backgroundColor={settings.dynamicStatusBar ? colors.background : undefined}
        />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: settings.reduceMotion ? 'none' : 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="save"
            options={{
              presentation: 'modal',
              animation: settings.reduceMotion ? 'none' : 'slide_from_bottom',
            }}
          />
          <Stack.Screen
            name="share"
            options={{
              presentation: 'modal',
              animation: settings.reduceMotion ? 'none' : 'slide_from_bottom',
            }}
          />
          <Stack.Screen name="item/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="collection/[id]" options={{ headerShown: false }} />
        </Stack>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <DataProvider>
          <SyncProvider>
            <AppContent />
          </SyncProvider>
        </DataProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
