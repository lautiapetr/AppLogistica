import type { ZoneColor } from '../types';

export const ZONE_COLOR_OPTIONS: Array<{ value: ZoneColor; label: string; hex: string }> = [
  { value: 'violet', label: 'Violeta', hex: '#5600ff' },
  { value: 'blue', label: 'Azul', hex: '#3b82f6' },
  { value: 'emerald', label: 'Verde', hex: '#10b981' },
  { value: 'amber', label: 'Ámbar', hex: '#f59e0b' },
  { value: 'rose', label: 'Rosa', hex: '#f43f5e' },
];

export const getZoneColorHex = (color: ZoneColor): string => (
  ZONE_COLOR_OPTIONS.find((option) => option.value === color)?.hex ?? '#5600ff'
);
