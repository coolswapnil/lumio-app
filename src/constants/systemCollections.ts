import type { ContentCategory } from '../types';

/** Maps every ContentCategory to its Level-1 system collection ID. */
export const SYSTEM_COLLECTION_MAP: Record<ContentCategory, string> = {
  Finance:        'sys-finance',
  Technology:     'sys-technology',
  Learning:       'sys-learning',
  'Real Estate':  'sys-real-estate',
  Travel:         'sys-travel',
  Food:           'sys-food',
  Entertainment:  'sys-entertainment',
  Career:         'sys-career',
  Science:        'sys-research',
  Other:          'sys-research',
  Business:       'sys-career',
  Health:         'sys-health',
  Sports:         'sys-entertainment',
  Lifestyle:      'sys-lifestyle',
  Politics:       'sys-research',
  Design:         'sys-technology',
};

/** Seed data for the 11 system collections (matches db.ts INSERT). */
export const SYSTEM_COLLECTIONS: Array<{
  id: string;
  name: string;
  icon: string;
  color: string;
  isSystem: true;
}> = [
  { id: 'sys-finance',       name: 'Finance',       icon: 'cash',             color: '#10b981', isSystem: true },
  { id: 'sys-technology',    name: 'Technology',    icon: 'hardware-chip',    color: '#0ea5e9', isSystem: true },
  { id: 'sys-learning',      name: 'Learning',      icon: 'school',           color: '#3b82f6', isSystem: true },
  { id: 'sys-real-estate',   name: 'Real Estate',   icon: 'home',             color: '#f59e0b', isSystem: true },
  { id: 'sys-travel',        name: 'Travel',        icon: 'airplane',         color: '#8b5cf6', isSystem: true },
  { id: 'sys-food',          name: 'Food',          icon: 'restaurant',       color: '#ef4444', isSystem: true },
  { id: 'sys-entertainment', name: 'Entertainment', icon: 'film',             color: '#ec4899', isSystem: true },
  { id: 'sys-career',        name: 'Career',        icon: 'briefcase',        color: '#6366f1', isSystem: true },
  { id: 'sys-research',      name: 'Research',      icon: 'search',           color: '#64748b', isSystem: true },
  { id: 'sys-health',        name: 'Health',        icon: 'fitness',          color: '#22c55e', isSystem: true },
  { id: 'sys-lifestyle',     name: 'Lifestyle',     icon: 'sunny',            color: '#f97316', isSystem: true },
];

/** Display names of the 11 system collections, used in the AI prompt. */
export const SYSTEM_COLLECTION_NAMES: string[] = SYSTEM_COLLECTIONS.map(c => c.name);
