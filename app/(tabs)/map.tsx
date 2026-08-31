import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import MapView, { Marker, Callout, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/context/ThemeContext';
import { useData } from '../../src/context/DataContext';
import { CONTENT_TYPE_CONFIG } from '../../src/constants';
import type { SavedItem } from '../../src/types';

export default function MapScreen() {
  const { colors, isDark } = useTheme();
  const { items } = useData();
  const router = useRouter();
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [region, setRegion] = useState({
    latitude: 20.5937,
    longitude: 78.9629,
    latitudeDelta: 30,
    longitudeDelta: 30,
  });

  // Items that have location data
  const mappedItems = items.filter((item) => item.latitude && item.longitude);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        const coords = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
        setUserLocation(coords);
        setRegion({ ...coords, latitudeDelta: 0.1, longitudeDelta: 0.1 });
      }
    })();
  }, []);

  const focusOnItem = (item: SavedItem) => {
    if (!item.latitude || !item.longitude) return;
    setRegion({
      latitude: item.latitude,
      longitude: item.longitude,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Map</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {mappedItems.length} {mappedItems.length === 1 ? 'place' : 'places'} saved
        </Text>
      </View>

      {mappedItems.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="map-outline" size={56} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No places saved yet</Text>
          <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>
            Save restaurants, travel destinations, and places to see them on the map.
          </Text>
          <TouchableOpacity onPress={() => router.push('/save')} style={styles.emptyBtn}>
            <Text style={styles.emptyBtnText}>Save a place</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <MapView
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          region={region}
          onRegionChangeComplete={setRegion}
          showsUserLocation={userLocation !== null}
          showsMyLocationButton
          userInterfaceStyle={isDark ? 'dark' : 'light'}
        >
          {mappedItems.map((item) => {
            const config = CONTENT_TYPE_CONFIG[item.contentType];
            return (
              <Marker
                key={item.id}
                coordinate={{ latitude: item.latitude!, longitude: item.longitude! }}
                pinColor={config.color}
                onCalloutPress={() => router.push(`/item/${item.id}`)}
              >
                <View style={[styles.markerPin, { backgroundColor: config.color }]}>
                  <Ionicons name={config.icon as any} size={14} color="#fff" />
                </View>
                <Callout tooltip>
                  <View style={[styles.callout, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.calloutTitle, { color: colors.text }]} numberOfLines={2}>
                      {item.title}
                    </Text>
                    {item.address ? (
                      <Text style={[styles.calloutAddress, { color: colors.textSecondary }]} numberOfLines={1}>
                        {item.address}
                      </Text>
                    ) : null}
                    <Text style={[styles.calloutTap, { color: '#3b82f6' }]}>Tap to view</Text>
                  </View>
                </Callout>
              </Marker>
            );
          })}
        </MapView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: { fontSize: 24, fontWeight: '800' },
  subtitle: { fontSize: 13, marginTop: 2 },
  map: { flex: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', marginTop: 12 },
  emptyDesc: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  emptyBtn: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  emptyBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  markerPin: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  callout: {
    width: 200,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 3,
  },
  calloutTitle: { fontSize: 13, fontWeight: '600' },
  calloutAddress: { fontSize: 11 },
  calloutTap: { fontSize: 11, fontWeight: '600', marginTop: 4 },
});
