import { useStore } from '../store'

export function UI() {
  const {
    hour,
    speed,
    isPaused,
    setHour,
    setSpeed,
    togglePause,
    autoRotate,
    rotationSpeed,
    zoom,
    setAutoRotate,
    setRotationSpeed,
    setZoom,
  } = useStore((state) => ({
    hour: state.time.hour,
    speed: state.time.speed,
    isPaused: state.time.isPaused,
    setHour: state.setHour,
    setSpeed: state.setSpeed,
    togglePause: state.togglePause,
    autoRotate: state.camera.autoRotate,
    rotationSpeed: state.camera.rotationSpeed,
    zoom: state.camera.zoom,
    setAutoRotate: state.setAutoRotate,
    setRotationSpeed: state.setRotationSpeed,
    setZoom: state.setZoom,
  }))

  const formatTime = (hour: number) => {
    const h = Math.floor(hour)
    const m = Math.floor((hour - h) * 60)
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
  }

  const getTimeOfDay = (hour: number) => {
    if (hour >= 6 && hour < 8) return 'Dawn'
    if (hour >= 8 && hour < 18) return 'Day'
    if (hour >= 18 && hour < 20) return 'Dusk'
    return 'Night'
  }

  return (
    <div style={styles.container}>
      {/* Title */}
      <div style={styles.title}>
        <h1 style={styles.titleText}>Medieval Stockholm 1554</h1>
        <p style={styles.subtitle}>Stadsholmen Island - Gamla Stan</p>
      </div>

      {/* Time Display */}
      <div style={styles.timeDisplay}>
        <div style={styles.timeInfo}>
          <div style={styles.clock}>{formatTime(hour)}</div>
          <div style={styles.timeOfDay}>{getTimeOfDay(hour)}</div>
        </div>
        <div style={styles.date}>June 15, 1554</div>
      </div>

      {/* Controls Panel */}
      <div style={styles.controlPanel}>
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Time Controls</h3>

          <div style={styles.control}>
            <label style={styles.label}>Time of Day</label>
            <input
              type="range"
              min="0"
              max="24"
              step="0.1"
              value={hour}
              onChange={(e) => setHour(parseFloat(e.target.value))}
              style={styles.slider}
            />
          </div>

          <div style={styles.control}>
            <label style={styles.label}>Speed: {speed.toFixed(1)}x</label>
            <input
              type="range"
              min="0.1"
              max="10"
              step="0.1"
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              style={styles.slider}
            />
          </div>

          <button onClick={togglePause} style={styles.button}>
            {isPaused ? '▶ Play' : '⏸ Pause'}
          </button>
        </div>

        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Camera Controls</h3>

          <div style={styles.control}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={autoRotate}
                onChange={(e) => setAutoRotate(e.target.checked)}
                style={styles.checkbox}
              />
              Auto Rotate
            </label>
          </div>

          {autoRotate && (
            <div style={styles.control}>
              <label style={styles.label}>
                Rotation Speed: {rotationSpeed.toFixed(1)}
              </label>
              <input
                type="range"
                min="0.1"
                max="2"
                step="0.1"
                value={rotationSpeed}
                onChange={(e) => setRotationSpeed(parseFloat(e.target.value))}
                style={styles.slider}
              />
            </div>
          )}

          <div style={styles.control}>
            <label style={styles.label}>Zoom: {zoom.toFixed(1)}x</label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              style={styles.slider}
            />
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={styles.legend}>
        <h3 style={styles.legendTitle}>Key Landmarks</h3>
        <div style={styles.legendItems}>
          <div style={styles.legendItem}>
            <div style={{ ...styles.legendColor, background: '#8b6b5a' }} />
            <span>Storkyrkan (Great Church)</span>
          </div>
          <div style={styles.legendItem}>
            <div style={{ ...styles.legendColor, background: '#6b5b4a' }} />
            <span>Three Crowns Castle</span>
          </div>
          <div style={styles.legendItem}>
            <div style={{ ...styles.legendColor, background: '#7a7a68' }} />
            <span>Stortorget Square</span>
          </div>
          <div style={styles.legendItem}>
            <div style={{ ...styles.legendColor, background: '#8b7355' }} />
            <span>Merchant Houses</span>
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div style={styles.instructions}>
        <p>🖱️ Left click + drag to rotate</p>
        <p>🖱️ Right click + drag to pan</p>
        <p>🖱️ Scroll to zoom</p>
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
    fontFamily: 'Georgia, serif',
    color: '#f5f5f5',
    textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
  },
  title: {
    position: 'absolute',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    textAlign: 'center',
  },
  titleText: {
    margin: 0,
    fontSize: '2.5rem',
    fontWeight: 'normal',
    letterSpacing: '2px',
  },
  subtitle: {
    margin: '5px 0 0 0',
    fontSize: '1rem',
    opacity: 0.9,
    fontStyle: 'italic',
  },
  timeDisplay: {
    position: 'absolute',
    top: '20px',
    right: '20px',
    background: 'rgba(0, 0, 0, 0.6)',
    padding: '15px 20px',
    borderRadius: '10px',
    backdropFilter: 'blur(10px)',
    pointerEvents: 'auto',
  },
  timeInfo: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    marginBottom: '5px',
  },
  clock: {
    fontSize: '2rem',
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  timeOfDay: {
    fontSize: '1rem',
    opacity: 0.8,
  },
  date: {
    fontSize: '0.9rem',
    opacity: 0.7,
    textAlign: 'right',
  },
  controlPanel: {
    position: 'absolute',
    bottom: '20px',
    left: '20px',
    background: 'rgba(0, 0, 0, 0.6)',
    padding: '20px',
    borderRadius: '10px',
    backdropFilter: 'blur(10px)',
    pointerEvents: 'auto',
    minWidth: '280px',
  },
  section: {
    marginBottom: '20px',
  },
  sectionTitle: {
    margin: '0 0 10px 0',
    fontSize: '1.1rem',
    borderBottom: '1px solid rgba(255,255,255,0.3)',
    paddingBottom: '5px',
  },
  control: {
    marginBottom: '12px',
  },
  label: {
    display: 'block',
    fontSize: '0.9rem',
    marginBottom: '5px',
    opacity: 0.9,
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '0.9rem',
    cursor: 'pointer',
  },
  checkbox: {
    cursor: 'pointer',
    width: '16px',
    height: '16px',
  },
  slider: {
    width: '100%',
    cursor: 'pointer',
  },
  button: {
    width: '100%',
    padding: '10px',
    background: 'rgba(255, 255, 255, 0.2)',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    borderRadius: '5px',
    color: '#f5f5f5',
    fontSize: '1rem',
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  legend: {
    position: 'absolute',
    bottom: '20px',
    right: '20px',
    background: 'rgba(0, 0, 0, 0.6)',
    padding: '15px',
    borderRadius: '10px',
    backdropFilter: 'blur(10px)',
    pointerEvents: 'auto',
    minWidth: '220px',
  },
  legendTitle: {
    margin: '0 0 10px 0',
    fontSize: '1rem',
    borderBottom: '1px solid rgba(255,255,255,0.3)',
    paddingBottom: '5px',
  },
  legendItems: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '0.85rem',
  },
  legendColor: {
    width: '20px',
    height: '20px',
    borderRadius: '3px',
    border: '1px solid rgba(255,255,255,0.3)',
  },
  instructions: {
    position: 'absolute',
    top: '50%',
    left: '20px',
    transform: 'translateY(-50%)',
    background: 'rgba(0, 0, 0, 0.5)',
    padding: '10px 15px',
    borderRadius: '8px',
    backdropFilter: 'blur(5px)',
    fontSize: '0.85rem',
  },
}
