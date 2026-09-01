import uuid from 'react-native-uuid';

/** Returns a new UUID v4 string. Use this instead of duplicating the cast in every file. */
export function generateId(): string {
  return uuid.v4() as string;
}
