'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { nanoid } from 'nanoid';
import { Crown, Cpu, Users, ChevronRight } from 'lucide-react';

export default function LandingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [selectedColor, setSelectedColor] = useState<'white' | 'black' | 'random'>('white');

  const createGame = () => {
    setLoading(true);
    const gameId = nanoid(10);

    // Local persistence
    let finalColor = selectedColor;
    if (selectedColor === 'random') {
      finalColor = Math.random() > 0.5 ? 'white' : 'black';
    }

    localStorage.setItem(`chess-game-${gameId}-role`, finalColor);

    // Navigation
    router.push(`/game/${gameId}`);
  };

  return (
    <main style={styles.container}>
      <div style={styles.hero}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.5rem', marginBottom: '1.5rem', marginTop: '3rem' }}>
          <img
            src="/Assets/White King.png"
            alt="White King"
            style={{ width: '52px', height: '52px', objectFit: 'contain', filter: 'drop-shadow(0 0 10px rgba(255,255,255,0.1))' }}
          />
          <h1 style={{ ...styles.title, marginBottom: 0 }}>Super <span style={{ color: 'var(--primary)' }}>Chess</span></h1>
          <img
            src="/Assets/Brown King.png"
            alt="Brown King"
            style={{ width: '52px', height: '52px', objectFit: 'contain', filter: 'drop-shadow(0 0 10px rgba(201, 168, 106, 0.2))' }}
          />
        </div>
        <p style={styles.subtitle}>Play chess online for free with anyone by sharing game link. No login/signup required.</p>

        <div className="glass" style={styles.card}>
          <h2 style={styles.cardTitle}>Create a Game</h2>

          <div style={styles.colorPicker}>
            <button
              onClick={() => setSelectedColor('white')}
              style={{ ...styles.colorBtn, ...(selectedColor === 'white' ? styles.colorBtnActive : {}) }}
            >
              White
            </button>
            <button
              onClick={() => setSelectedColor('random')}
              style={{ ...styles.colorBtn, ...(selectedColor === 'random' ? styles.colorBtnActive : {}) }}
            >
              Random
            </button>
            <button
              onClick={() => setSelectedColor('black')}
              style={{ ...styles.colorBtn, ...(selectedColor === 'black' ? styles.colorBtnActive : {}) }}
            >
              Black
            </button>
          </div>

          <button
            onClick={createGame}
            disabled={loading}
            style={styles.mainBtn}
          >
            {loading ? 'Creating...' : 'Start Playing'}
            <ChevronRight size={20} />
          </button>
        </div>


      </div>

      <footer style={styles.footer}>
        Developed by Imteyaz Arif
      </footer>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100dvh',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1.5rem',
    background: 'radial-gradient(circle at center, #1a1a1a 0%, #0a0a0a 100%)',
    overflow: 'hidden',
  },
  hero: {
    textAlign: 'center',
    maxWidth: '600px',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 'clamp(1.8rem, 10vw, 4.5rem)',
    fontWeight: 800,
    marginBottom: '0',
    letterSpacing: '-2px',
    lineHeight: '1.1',
  },
  subtitle: {
    fontSize: 'clamp(0.9rem, 4vw, 1.3rem)',
    color: '#888',
    marginTop: '0.4rem',
    marginBottom: 'clamp(1.5rem, 6vw, 4rem)',
    lineHeight: '1.5',
  },
  card: {
    width: '100%',
    padding: '2.5rem',
    textAlign: 'left',
    marginBottom: '3rem',
  },
  cardTitle: {
    fontSize: '1.8rem',
    marginBottom: '1.5rem',
    fontWeight: 600,
  },
  colorPicker: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '2rem',
    background: 'rgba(0,0,0,0.3)',
    padding: '0.4rem',
    borderRadius: '12px',
  },
  colorBtn: {
    flex: 1,
    padding: '0.8rem',
    background: 'transparent',
    color: '#888',
    borderRadius: '8px',
    fontSize: '0.9rem',
  },
  colorBtnActive: {
    background: 'var(--primary)',
    color: 'black',
  },
  mainBtn: {
    width: '100%',
    padding: '1.2rem',
    background: 'var(--primary)',
    color: 'black',
    fontSize: '1.1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    borderRadius: '12px',
    boxShadow: '0 4px 20px rgba(201, 168, 106, 0.3)',
  },
  features: {
    display: 'flex',
    justifyContent: 'center',
    gap: '2rem',
    flexWrap: 'wrap',
  },
  feature: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    color: '#888',
    fontSize: '0.9rem',
  },
  footer: {
    marginTop: 'auto',
    color: 'rgba(255,255,255,0.4)',
    fontSize: '0.9rem',
    fontWeight: 500,
    letterSpacing: '1px',
    padding: '1.5rem 0',
  }
};