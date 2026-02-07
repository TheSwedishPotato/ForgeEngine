export interface TimeState {
  hour: number; // 0-24
  speed: number;
  isPaused: boolean;
}

export interface CameraState {
  autoRotate: boolean;
  rotationSpeed: number;
  zoom: number;
}

export interface BuildingType {
  id: string;
  name: string;
  position: [number, number, number];
  rotation: number;
  type: 'church' | 'castle' | 'merchant' | 'dwelling' | 'guild' | 'tavern' | 'warehouse';
  stories: number;
}

export interface NPCType {
  id: string;
  type: 'peasant' | 'merchant' | 'guard' | 'fisherman' | 'vendor';
  path: [number, number, number][];
  speed: number;
  currentPathIndex: number;
}

export interface AnimalType {
  id: string;
  type: 'chicken' | 'horse' | 'sheep' | 'cattle' | 'seagull';
  position: [number, number, number];
  wanderRadius?: number;
  flyHeight?: number;
}
