import { create } from 'zustand'
import { TimeState, CameraState } from './types'

interface StoreState {
  // Time management
  time: TimeState;
  setHour: (hour: number) => void;
  setSpeed: (speed: number) => void;
  togglePause: () => void;
  updateTime: (delta: number) => void;

  // Camera management
  camera: CameraState;
  setAutoRotate: (autoRotate: boolean) => void;
  setRotationSpeed: (speed: number) => void;
  setZoom: (zoom: number) => void;
}

export const useStore = create<StoreState>((set, get) => ({
  // Initial time state - start at 8 AM
  time: {
    hour: 8,
    speed: 1, // 1 = realtime, higher = faster
    isPaused: false,
  },

  setHour: (hour) =>
    set((state) => ({
      time: { ...state.time, hour: hour % 24 },
    })),

  setSpeed: (speed) =>
    set((state) => ({
      time: { ...state.time, speed },
    })),

  togglePause: () =>
    set((state) => ({
      time: { ...state.time, isPaused: !state.time.isPaused },
    })),

  updateTime: (delta) => {
    const { time } = get()
    if (!time.isPaused) {
      // Convert delta to hours (delta is in seconds)
      // Speed multiplier: 1 = 1 real second = 1 game second
      // For faster cycle, we want 1 real minute = 1 game hour (multiply by 60)
      const hourIncrement = (delta * time.speed * 60) / 3600
      const newHour = (time.hour + hourIncrement) % 24
      set((state) => ({
        time: { ...state.time, hour: newHour },
      }))
    }
  },

  // Initial camera state
  camera: {
    autoRotate: true,
    rotationSpeed: 0.2,
    zoom: 1.0,
  },

  setAutoRotate: (autoRotate) =>
    set((state) => ({
      camera: { ...state.camera, autoRotate },
    })),

  setRotationSpeed: (rotationSpeed) =>
    set((state) => ({
      camera: { ...state.camera, rotationSpeed },
    })),

  setZoom: (zoom) =>
    set((state) => ({
      camera: { ...state.camera, zoom: Math.max(0.5, Math.min(2, zoom)) },
    })),
}))
