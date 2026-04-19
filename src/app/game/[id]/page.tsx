'use client';

import { useEffect, useState, useMemo, use, useRef } from 'react';
import Link from 'next/link';

import { Chess, Square } from 'chess.js';
import { Chessboard, defaultPieces } from 'react-chessboard';
import { useChessGame, PlayerColor, playAudio } from '@/hooks/useChessGame';
import { Share2, MessageSquare, History, Undo2, Flag, Handshake, ChevronLeft, ChevronRight, X, Eye, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { nanoid } from 'nanoid';
import * as Ably from 'ably';


const getPieceKey = (type: string, color: 'w' | 'b'): string => {
  return color + type.toUpperCase();
};

interface ChatMessage {
  id: string;
  role: string;
  text: string;
}

const PlayerBox = ({ role, turn, viewerRole, isOpponent = false, capturedPieces = [], themeColor = '#aa6600' }: { role: string, turn: string, viewerRole: string, isOpponent?: boolean, capturedPieces?: string[], themeColor?: string }) => {
  const isTurn = (role === 'white' && turn === 'w') || (role === 'black' && turn === 'b');
  const capturedPieceColor: 'w' | 'b' = role === 'white' ? 'b' : 'w';
  const displayRole = role.charAt(0).toUpperCase() + role.slice(1);
  const textColor = role === 'black' ? '#000' : '#fff';
  const mutedTextColor = role === 'black' ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.5)';

  return (
    <div style={{
      ...styles.playerBox,
      background: themeColor,
      backdropFilter: 'none',
      borderColor: isTurn ? 'var(--primary)' : 'rgba(255, 255, 255, 0.2)',
      boxShadow: isTurn ? '0 0 15px var(--primary)' : 'none',
      display: 'flex',
      alignItems: 'center',
      height: '80px',
      padding: '0 1.2rem',
      gap: '1rem',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, justifyContent: 'center', height: '100%' }}>
        <span style={{ ...styles.playerName, color: textColor, marginBottom: capturedPieces.length > 0 ? '4px' : '0' }}>
          {isOpponent
            ? (viewerRole === 'spectator' ? (role === 'black' ? 'Black' : 'White') : `Opponent (${displayRole})`)
            : (viewerRole === 'spectator' ? 'You (Spectator)' : `You (${displayRole})`)}
        </span>
        {capturedPieces.length > 0 && (() => {
          const hierarchy: Record<string, number> = { p: 0, n: 1, b: 2, r: 3, q: 4 };
          const sorted = [...capturedPieces].sort((a, b) => (hierarchy[a] ?? 0) - (hierarchy[b] ?? 0));
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1px' }}>
              {sorted.map((p, i) => {
                const key = getPieceKey(p, capturedPieceColor);
                const PieceComponent = defaultPieces[key];
                return (
                  <div key={i} style={{ width: '20px', height: '20px' }}>
                    {PieceComponent ? PieceComponent() : p}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Status indicator */}
      <div style={{
        minWidth: '85px',
        flexShrink: 0,
        textAlign: 'right',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end'
      }}>
        <span style={{
          fontSize: '0.8rem',
          fontWeight: 700,
          color: isTurn ? textColor : (viewerRole === 'spectator' ? mutedTextColor : 'transparent'),
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}>
          {viewerRole === 'spectator'
            ? (isTurn ? `${displayRole}'s Turn` : (role === 'white' ? (turn === 'b' ? "" : "") : ""))
            : (isTurn ? (isOpponent ? 'Their Turn' : 'Your Turn') : '')}
          {/* Turn logic */}
          {viewerRole === 'spectator' && !isTurn && ((role === 'white' && turn === 'w') || (role === 'black' && turn === 'b')) && `${displayRole}'s Turn`}
        </span>
      </div>
    </div>
  );
};

const KingIcon = ({ color, size = 32 }: { color: string, size?: number }) => {
  const isBrown = color === 'var(--primary)' || color === '#b48762';
  const imgSrc = isBrown ? '/Assets/Brown King.png' : '/Assets/White King.png';

  return (
    <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img
        src={imgSrc}
        alt="King"
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    </div>
  );
};

export default function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [isMounted, setIsMounted] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  const [boardTheme, setBoardTheme] = useState<'brown' | 'green'>('brown');
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<'resign' | 'draw' | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');
  const [windowSize, setWindowSize] = useState<{ width: number; height: number } | null>(null);
  const [activeTabMobile, setActiveTabMobile] = useState<'chat' | 'history'>('history');
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const validMovesRef = useRef<Set<string>>(new Set());
  const isMobile = windowSize ? (windowSize.width < 1024 || windowSize.width < windowSize.height) : false;
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const historyContainerRef = useRef<HTMLDivElement>(null);

  // Client mount lifecycle
  useEffect(() => {
    setIsMounted(true);
    setWindowSize({ width: window.innerWidth, height: window.innerHeight });
  }, []);

  // Game logic hook
  const gameLogic = useChessGame({
    gameId: id
  });

  const {
    game, fen, makeMove, playerColor, status,
    chatMessages, sendMessage, takebackRequest, takebackPending, requestTakeback, respondToTakeback, cancelTakeback,
    drawRequest, drawPending, offerDraw, respondToDraw, cancelDraw,
    rematchRequest, rematchPending, offerRematch, respondToRematch, cancelRematch,
    resign, outcome,
    isCheck, isCheckmate, isDraw, isGameOver, turn, participants, capturedPieces
  } = gameLogic;


  // Stale closure management
  const turnRef = useRef(turn);
  const playerColorRef_local = useRef(playerColor);

  useEffect(() => {
    turnRef.current = turn;
    playerColorRef_local.current = playerColor;
  }, [turn, playerColor]);

  // Review state synchronization
  const gameHistory = game.history();
  useEffect(() => {
    if (reviewIndex !== null && reviewIndex === gameHistory.length - 1) {
      setReviewIndex(null);
    }
  }, [gameHistory.length]);


  // Game state selector
  const currentViewedGame = useMemo(() => {
    if (reviewIndex !== null && reviewIndex < gameHistory.length) {
      const tempGame = new Chess();
      tempGame.loadPgn(game.pgn());
      const h = tempGame.history();
      const redo = new Chess();
      for (let i = 0; i < reviewIndex; i++) redo.move(h[i]);
      return redo;
    }
    return game;
  }, [reviewIndex, gameHistory, game]);

  const displayFen = currentViewedGame.fen();

  // Link management
  useEffect(() => {
    setInviteUrl(window.location.href);
  }, []);

  // Win effects
  useEffect(() => {
    if (isGameOver && (isCheckmate || isDraw || outcome)) {
      playAudio('gameEnd');
      const duration = 3 * 1000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 3000 };

      const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

      const interval: number = window.setInterval(function () {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);
        confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
        confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
      }, 250);

      return () => clearInterval(interval);
    }
  }, [isGameOver, isCheckmate, isDraw, outcome]);

  // Resize sync
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Scroll management
  useEffect(() => {
    const container = chatContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, [chatMessages]);

  // History scroll
  useEffect(() => {
    const container = historyContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, [gameHistory.length]);

  // Layout calculations
  const { boardWidth, sidebarHeight } = useMemo(() => {
    if (!windowSize) return { boardWidth: 600, sidebarHeight: 700 };

    const isMobileLocal = windowSize.width < 1024 || windowSize.width < windowSize.height;

    // Desktop: Reserve 660px for 2 sidebars (260x2) + gaps (140)
    // Mobile: Reserve 20px (10px each side) to match the main container padding
    const horizontalOverhead = isMobileLocal ? 20 : 660;
    let availableWidth = windowSize.width - horizontalOverhead;

    if (isMobileLocal) {
      // Allow dynamic scaling without hard caps for mobile/portrait, the board size
      // will naturally be limited by availableHeight to keep the board on screen.
      availableWidth = windowSize.width - horizontalOverhead;
    }

    // Balanced overhead:
    // Header (Mobile: ~100) + Player Boxes (80x2 = 160) + Gaps
    const verticalOverhead = isMobileLocal ? 340 : 346;
    const availableHeight = windowSize.height - verticalOverhead;

    const width = Math.min(availableWidth, availableHeight);
    const finalBoardWidth = Math.max(width, 280);

    // Sidebar height refined to match the visual bottom of the chessboard squares
    // Calculation: PlayerBox (80) + Gap (20) + Board + Fine-tuning (3px for coordinates/borders)
    const calculatedSidebarHeight = isMobileLocal ? 350 : (100 + finalBoardWidth);

    return { boardWidth: finalBoardWidth, sidebarHeight: calculatedSidebarHeight };
  }, [windowSize]);


  // Opponent connection status
  const opponentConnected = participants.some((m: Ably.PresenceMessage) => m.data?.color === 'white') && participants.some((m: Ably.PresenceMessage) => m.data?.color === 'black');

  const opponentConnectedRef = useRef(opponentConnected);
  useEffect(() => {
    opponentConnectedRef.current = opponentConnected;
  }, [opponentConnected]);

  // Game rules validation
  const isPromotion = (from: string, to: string): boolean => {
    const piece = game.get(from as Square);
    if (!piece || piece.type !== 'p') return false;
    const targetRank = to[1];
    return (piece.color === 'w' && targetRank === '8') || (piece.color === 'b' && targetRank === '1');
  };

  const onDrop = ({ sourceSquare, targetSquare }: { sourceSquare: string, targetSquare: string | null }) => {
    if (!targetSquare) return false;
    if (!opponentConnected) return false;
    if (isGameOver) return false;
    if (reviewIndex !== null && reviewIndex < gameHistory.length) return false;

    const isOurTurn = (turn === 'w' && playerColor === 'white') || (turn === 'b' && playerColor === 'black');
    if (!isOurTurn) return false;

    // Promotion handling
    if (isPromotion(sourceSquare, targetSquare)) {
      setPendingPromotion({ from: sourceSquare, to: targetSquare });
      setSelectedSquare(null);
      return true; // Accept the drop visually; we'll finalize after choice
    }

    const move = makeMove({
      from: sourceSquare,
      to: targetSquare,
    });

    setSelectedSquare(null);
    return move !== null;
  };

  // Move interactions
  const handleSquareClick = ({ square }: { piece: unknown; square: string }) => {
    if (!opponentConnected) return;
    if (isGameOver) return;
    if (reviewIndex !== null && reviewIndex < gameHistory.length) return;

    const isOurTurn = (turn === 'w' && playerColor === 'white') || (turn === 'b' && playerColor === 'black');
    if (!isOurTurn) {
      setSelectedSquare(null);
      return;
    }

    // Deselection logic
    if (selectedSquare === square) {
      setSelectedSquare(null);
      return;
    }

    // Move logic
    if (selectedSquare && selectedSquare !== square) {
      // Interaction refinement
      const clickedPiece = game.get(square as import('chess.js').Square);
      if (clickedPiece && clickedPiece.color === turn) {
        setSelectedSquare(square);
        return;
      }

      // Check for promotion
      if (isPromotion(selectedSquare, square)) {
        setPendingPromotion({ from: selectedSquare, to: square });
        setSelectedSquare(null);
        return;
      }

      const move = makeMove({
        from: selectedSquare,
        to: square,
      });
      if (move) {
        setSelectedSquare(null);
        return;
      }
    }


    // Selection sync
    const piece = game.get(square as import('chess.js').Square);
    if (piece && piece.color === turn) {
      setSelectedSquare(square);
    } else {
      setSelectedSquare(null);
    }
  };

  // Square highlights
  const dynamicSquareStyles = useMemo(() => {
    const sqStyles: Record<string, React.CSSProperties> = {};
    if (selectedSquare) {
      const pieceOnSquare = currentViewedGame.get(selectedSquare as Square);
      const currentTurn = currentViewedGame.turn();
      if (pieceOnSquare && pieceOnSquare.color === currentTurn) {
        sqStyles[selectedSquare] = { backgroundColor: 'rgba(212, 175, 55, 0.4)' };
        const moves = currentViewedGame.moves({ square: selectedSquare as Square, verbose: true });
        for (const move of moves) {
          if (move.captured) {
            sqStyles[move.to] = {
              boxShadow: 'inset 0 0 0 4px rgba(244, 67, 54, 0.7)',
              borderRadius: 0
            };
          } else {
            sqStyles[move.to] = {
              backgroundImage: 'radial-gradient(circle, var(--highlight-move-glow) 24%, transparent 25%)',
            };
          }
        }
      }
    }
    if (currentViewedGame.isCheck()) {
      const board = currentViewedGame.board();
      const currentTurn = currentViewedGame.turn();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const sq = board[r][c];
          if (sq && sq.type === 'k' && sq.color === currentTurn) {
            const kingSquare = `${String.fromCharCode(97 + c)}${8 - r}`;
            sqStyles[kingSquare] = {
              ...sqStyles[kingSquare],
              backgroundColor: 'rgba(244, 67, 54, 0.6)',
              boxShadow: 'inset 0 0 15px 5px rgba(244, 67, 54, 0.9)',
              borderRadius: 0
            };
          }
        }
      }
    }
    return sqStyles;
  }, [selectedSquare, currentViewedGame, hoveredSquare]);

  const oppColor = playerColor === 'white' ? 'black' : playerColor === 'black' ? 'white' : 'black';

  const themeColors = {
    brown: { dark: '#b48762', light: '#ebecd0', box: '#b48762' },
    green: { dark: '#739552', light: '#ebecd0', box: '#739552' }
  };
  const activeTheme = themeColors[boardTheme as keyof typeof themeColors];

  const customGreenPieces = useMemo(() => {
    const piecesMap: Record<string, (props: any) => React.JSX.Element> = {};
    const pieceTypes = ['Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King'];
    const codes = ['P', 'N', 'B', 'R', 'Q', 'K'];

    codes.forEach((code, i) => {
      const type = pieceTypes[i];
      piecesMap[`w${code}`] = () => (
        <img
          src={`/Assets/Pieces/White Pieces/White ${type}.png`}
          alt={`White ${type}`}
          style={{ width: '100%', height: '100%' }}
        />
      );
      piecesMap[`b${code}`] = () => (
        <img
          src={`/Assets/Pieces/Black Pieces/Black ${type}.png`}
          alt={`Black ${type}`}
          style={{ width: '100%', height: '100%' }}
        />
      );
    });
    return piecesMap;
  }, []);

  // Board configuration
  const chessboardOptions = useMemo(() => {
    const config: any = {
      position: displayFen,
      boardOrientation: (playerColor === 'black' ? 'black' : 'white') as any,
      boardStyle: { width: boardWidth, height: boardWidth },
      pieces: boardTheme === 'green' ? customGreenPieces : undefined,
      onPieceDrop: ({ sourceSquare, targetSquare }: any) => {
        setIsDragging(false);
        return onDrop({ sourceSquare, targetSquare });
      },
      onSquareClick: ({ square }: any) => handleSquareClick({ square, piece: game.get(square as Square) }),
      onPieceDragBegin: () => {
        setIsDragging(true);
      },
      onPieceDragEnd: () => {
        setIsDragging(false);
        validMovesRef.current.clear();
        // DOM cleanup
        document.querySelectorAll('.drag-hover-move, .drag-hover-capture').forEach(el => {
          el.classList.remove('drag-hover-move', 'drag-hover-capture');
        });
      },
      onPieceDrag: ({ square }: any) => {
        if (!square || !opponentConnectedRef.current) return;

        // Move caching
        const currentTurn = turnRef.current;
        const currentColor = playerColorRef_local.current;
        if ((currentTurn === 'w' && currentColor === 'white') || (currentTurn === 'b' && currentColor === 'black')) {
          const p = game.get(square as Square);
          if (p && p.color === currentTurn) {
            // Set selection for React logic
            if (selectedSquare !== square) setSelectedSquare(square);

            // DOM cache update
            const moves = game.moves({ square: square as Square, verbose: true });
            validMovesRef.current = new Set(moves.map(m => m.to));
            setIsDragging(true);
          }
        }
      },
      onMouseOverSquare: ({ square }: any) => {
        if (!square) return;

        // Visual feedback logic
        if (isDragging || selectedSquare) {
          const source = (isDragging ? selectedSquare : selectedSquare) as Square;
          if (!source) return;

          const moves = game.moves({ square: source, verbose: true });
          const move = moves.find(m => m.to === square);

          if (move) {
            const sqEl = document.querySelector(`[data-square="${square}"]`);
            if (sqEl) {
              sqEl.classList.add(move.captured ? 'drag-hover-capture' : 'drag-hover-move');
            }
          }

          if (!isDragging) setHoveredSquare(square);
        } else {
          setHoveredSquare(square);
        }
      },
      onMouseOutSquare: ({ square }: any) => {
        if (square) {
          const sqEl = document.querySelector(`[data-square="${square}"]`);
          if (sqEl) {
            sqEl.classList.remove('drag-hover-move', 'drag-hover-capture');
          }
        }
        if (!isDragging) setHoveredSquare(null);
      },
      dropSquareStyle: { boxShadow: 'none' },
      squareStyles: dynamicSquareStyles,
      darkSquareStyle: { backgroundColor: activeTheme.dark },
      lightSquareStyle: { backgroundColor: activeTheme.light },
      animationDurationInMs: 200,
    };
    return config;
  }, [displayFen, playerColor, boardWidth, boardTheme, customGreenPieces, onDrop, handleSquareClick, game, opponentConnectedRef, selectedSquare, dynamicSquareStyles, activeTheme, isDragging]);

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handlePromotionChoice = async (piece: 'q' | 'r' | 'b' | 'n') => {
    if (!pendingPromotion) return;
    const success = await makeMove({ from: pendingPromotion.from, to: pendingPromotion.to, promotion: piece });
    if (success) {
      setPendingPromotion(null);
      setSelectedSquare(null);
    }
  };

  const cancelPromotion = () => {
    setPendingPromotion(null);
  };

  if (!isMounted) {
    return (
      <div style={{ ...styles.page, background: '#1e1f20' }} />
    );
  }

  return (
    <div style={styles.page}>
      <header style={{
        ...styles.header,
        height: isMobile ? 'auto' : styles.header.height,
        flexDirection: isMobile ? 'column' : 'row',
        padding: isMobile ? '12px 1rem' : styles.header.padding,
        gap: isMobile ? '10px' : '0',
        flexShrink: 0,
        zIndex: 10,
        position: 'relative'
      }}>
        {isMobile ? (
          <>
            {/* Mobile Row 1: Logo + Credits */}
            <Link href="/" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', textDecoration: 'none', color: 'inherit' }}>
              <img
                src="/Assets/White King.png"
                alt="White King"
                style={{ width: '24px', height: '24px', objectFit: 'contain' }}
              />
              <div style={{ ...styles.logo, fontSize: '1.1rem', letterSpacing: '1px' }}>
                SUPER <span style={{ color: 'var(--primary)' }}>CHESS</span>
              </div>
              <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.3)', margin: '0 4px' }} />
              <span style={{
                fontSize: '0.65rem',
                fontWeight: 300,
                color: 'rgba(255,255,255,0.5)',
                fontFamily: "'Outfit', sans-serif",
                textTransform: 'uppercase',
                letterSpacing: '2px'
              }}>
                by <span style={{ fontWeight: 500, color: 'rgba(255,255,255,0.8)' }}>Imteyaz Arif</span>
              </span>
            </Link>

            {/* Layout metadata */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '10px' }}>
              <div style={{ ...styles.participantsBox, background: 'rgba(255,255,255,0.05)', padding: '4px 10px' }}>
                <Eye size={14} style={{ color: 'var(--primary)' }} />
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#aaa' }}>
                  {participants.filter((p: Ably.PresenceMessage) => p.data?.color === 'spectator').length}
                </span>
              </div>

              <span style={{
                ...styles.statusBadge,
                borderColor: opponentConnected ? 'rgba(76, 175, 80, 0.2)' : 'rgba(212, 175, 55, 0.2)',
                color: opponentConnected ? '#4caf50' : 'var(--primary)',
                background: opponentConnected ? 'rgba(76, 175, 80, 0.05)' : 'rgba(212, 175, 55, 0.05)',
                fontSize: '0.75rem',
                padding: '4px 10px'
              }}>
                <div style={{ ...styles.dot, backgroundColor: opponentConnected ? '#4caf50' : 'var(--primary)', width: '6px', height: '6px' }} />
                {opponentConnected ? 'Connected' : 'Waiting'}
              </span>
            </div>
          </>
        ) : (
          <>
            {/* Left: Spectators */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ ...styles.participantsBox, background: 'rgba(255,255,255,0.05)', padding: '6px 14px' }}>
                <Eye size={18} style={{ color: 'var(--primary)' }} />
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#aaa' }}>
                  {participants.filter((p: Ably.PresenceMessage) => p.data?.color === 'spectator').length}
                </span>
              </div>
            </div>

            {/* Center: Logo */}
            <Link href="/" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', whiteSpace: 'nowrap', textDecoration: 'none', color: 'inherit' }}>
              <img
                src="/Assets/White King.png"
                alt="White King"
                style={{ width: '36px', height: '36px', objectFit: 'contain', filter: 'drop-shadow(0 0 5px rgba(255,255,255,0.1))' }}
              />
              <div style={{ ...styles.logo, fontSize: '1.6rem', letterSpacing: '1.5px', margin: 0 }}>
                SUPER <span style={{ color: 'var(--primary)' }}>CHESS</span>
              </div>
              <img
                src="/Assets/Brown King.png"
                alt="Brown King"
                style={{ width: '36px', height: '36px', objectFit: 'contain', filter: 'drop-shadow(0 0 5px rgba(201, 168, 106, 0.2))' }}
              />
              <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.5)', margin: '0 8px' }} />

              <span style={{
                fontSize: '0.85rem',
                fontWeight: 300,
                color: 'rgba(255,255,255,0.5)',
                textTransform: 'uppercase',
                letterSpacing: '2px',
                fontFamily: "'Outfit', sans-serif"
              }}>
                by <span style={{ fontWeight: 500, color: 'rgba(255,255,255,0.8)' }}>Imteyaz Arif</span>
              </span>
            </Link>

            {/* Right: Status */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
              <span style={{
                ...styles.statusBadge,
                borderColor: opponentConnected ? 'rgba(76, 175, 80, 0.2)' : 'rgba(212, 175, 55, 0.2)',
                color: opponentConnected ? '#4caf50' : 'var(--primary)',
                background: opponentConnected ? 'rgba(76, 175, 80, 0.05)' : 'rgba(212, 175, 55, 0.05)',
                fontSize: '0.8rem',
                padding: '6px 12px'
              }}>
                <div style={{ ...styles.dot, backgroundColor: opponentConnected ? '#4caf50' : 'var(--primary)' }} />
                {opponentConnected ? 'Connected with player' : 'Waiting for player'}
              </span>
            </div>
          </>
        )}
      </header>

      <main style={{
        ...styles.main,
        flexDirection: isMobile ? 'column' : 'row',
        padding: isMobile ? '12px 10px 48px 10px' : styles.main.padding,
        flexWrap: isMobile ? 'nowrap' : 'nowrap',
        overflowY: isMobile ? 'auto' : 'hidden',
        alignItems: isMobile ? 'center' : 'flex-start',
        justifyContent: isMobile ? 'flex-start' : 'center',
        gap: isMobile ? '16px' : '32px'
      }}>

        {/* Main layout */}
        {!isMobile && (
          <>
            {/* Left Side: Chat */}
            <div style={{ display: 'flex', flexDirection: 'column', width: 260 }}>
              <aside className="glass" style={{ ...styles.panel, height: sidebarHeight, width: '100%' }}>
                <div style={styles.panelTabs}>
                  <button style={{ ...styles.tab, borderBottom: '2px solid var(--primary)', cursor: 'default' }}>
                    <MessageSquare size={16} /> Chat
                  </button>
                </div>
                <div style={styles.panelContent}>
                  <div style={styles.chatSection}>
                    <div ref={chatContainerRef} style={styles.messages}>
                      {chatMessages.map((msg: ChatMessage) => {
                        let displayRole = msg.role ? msg.role.charAt(0).toUpperCase() + msg.role.slice(1) : '';
                        if (playerColor !== 'spectator') {
                          if (msg.role === playerColor) displayRole = 'You';
                          else if (msg.role === 'white' || msg.role === 'black') displayRole = 'Opponent';
                        }
                        let roleColor = 'var(--primary)';
                        if (msg.role === 'white') roleColor = '#fff';
                        if (msg.role === 'spectator') roleColor = '#739552';

                        return (
                          <div key={msg.id} style={styles.msg}>
                            <span style={{ ...styles.msgRole, color: roleColor }}>{displayRole}:</span> {msg.text}
                          </div>
                        );
                      })}
                    </div>
                    <div style={styles.chatInputWrapper}>
                      <input
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            const trimmed = chatInput.trim();
                            if (trimmed) {
                              sendMessage(trimmed);
                              setChatInput('');
                            }
                          }
                        }}
                        placeholder="Type a message..."
                        style={styles.chatInput}
                      />
                    </div>
                  </div>
                </div>
              </aside>

              {isGameOver && playerColor !== 'spectator' && (
                <button
                  onClick={() => {
                    const newId = nanoid(10);
                    window.location.href = `/game/${newId}`;
                  }}
                  style={{
                    ...styles.mainBtn,
                    background: '#4caf50',
                    borderRadius: '8px',
                    height: '80px',
                    fontSize: '1.1rem',
                    fontWeight: 600,
                    boxShadow: '0 4px 15px rgba(76, 175, 80, 0.3)',
                    color: 'white',
                    marginTop: '20px',
                    width: '100%'
                  }}
                >
                  New Game
                </button>
              )}
            </div>

            {/* Middle: Board */}
            <section style={{ ...styles.boardContainer, width: boardWidth }} data-board-theme={boardTheme}>
              <div style={{ ...styles.boardHeader, maxWidth: boardWidth }}>
                <PlayerBox role={oppColor} turn={turn} viewerRole={playerColor} isOpponent capturedPieces={oppColor === 'white' ? capturedPieces.white : capturedPieces.black} themeColor={activeTheme.box} />
              </div>

              <div style={{ ...styles.boardWrapper, width: boardWidth, height: boardWidth, position: 'relative' }}>
                <Chessboard options={chessboardOptions} />

                {/* Overlay components */}
                {pendingPromotion && (() => {
                  const sqSize = boardWidth / 8;
                  const file = pendingPromotion.to.charCodeAt(0) - 97;
                  const isWhitePromo = pendingPromotion.to[1] === '8';
                  const boardFlipped = playerColor === 'black';
                  const colFromLeft = boardFlipped ? (7 - file) : file;
                  const fromTop = (isWhitePromo && !boardFlipped) || (!isWhitePromo && boardFlipped);
                  const promoColor = isWhitePromo ? 'w' : 'b';
                  const pieces: { key: 'q' | 'r' | 'b' | 'n'; pieceKey: string }[] = [
                    { key: 'q', pieceKey: getPieceKey('q', promoColor as 'w' | 'b') },
                    { key: 'r', pieceKey: getPieceKey('r', promoColor as 'w' | 'b') },
                    { key: 'b', pieceKey: getPieceKey('b', promoColor as 'w' | 'b') },
                    { key: 'n', pieceKey: getPieceKey('n', promoColor as 'w' | 'b') },
                  ];

                  return (
                    <>
                      <div onClick={cancelPromotion} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10, borderRadius: '4px' }} />
                      <div style={{ position: 'absolute', left: colFromLeft * sqSize, top: fromTop ? 0 : undefined, bottom: fromTop ? undefined : 0, width: sqSize, zIndex: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.6)', borderRadius: '4px', overflow: 'hidden' }}>
                        {pieces.map((p) => {
                          const isLight = (colFromLeft + pieces.indexOf(p)) % 2 === (fromTop ? 0 : 1);
                          const PieceComponent = boardTheme === 'green' ? customGreenPieces[p.pieceKey] : defaultPieces[p.pieceKey];
                          return (
                            <button key={p.key} onClick={() => handlePromotionChoice(p.key)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: sqSize, height: sqSize, background: isLight ? activeTheme.light : activeTheme.dark, border: 'none', cursor: 'pointer', padding: sqSize * 0.08 }}>
                              {PieceComponent ? PieceComponent({}) : p.key}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </div>

              <div style={{ ...styles.boardFooter, width: boardWidth }}>
                <PlayerBox role={playerColor === 'spectator' ? 'white' : playerColor} turn={turn} viewerRole={playerColor} capturedPieces={playerColor === 'white' ? capturedPieces.white : (playerColor === 'black' ? capturedPieces.black : capturedPieces.white)} themeColor={activeTheme.box} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', width: '100%', maxWidth: boardWidth, marginTop: '-8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(0,0,0,0.3)', padding: '10px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', width: '100%' }}>
                  <span style={{ color: '#888', fontSize: '0.75rem', whiteSpace: 'nowrap', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Match Link</span>
                  <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.85rem', color: '#ccc', fontFamily: 'monospace' }}>{inviteUrl}</div>
                  <button onClick={copyLink} style={{ background: 'none', border: 'none', color: linkCopied ? '#4caf50' : '#888', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    {linkCopied ? <Check size={20} /> : <Copy size={20} />}
                  </button>
                </div>
              </div>
            </section>

            {/* Right Side: Theme and History */}
            <div style={{ display: 'flex', flexDirection: 'column', width: 260 }}>
              <aside className="glass" style={{ ...styles.panel, height: sidebarHeight, width: '100%' }}>
                {/* Theme Section */}
                <div style={{ padding: '1.2rem 1rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#888', marginBottom: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Board Theme</div>
                  <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'center' }}>
                    <button onClick={() => setBoardTheme('brown')} style={{ background: 'none', padding: 0, border: boardTheme === 'brown' ? '2px solid var(--primary)' : '2px solid transparent', borderRadius: '6px', opacity: boardTheme === 'brown' ? 1 : 0.6, width: '45px', height: '45px', overflow: 'hidden', cursor: 'pointer' }}>
                      <img src="/Assets/Themes/Brown Board.png" alt="Brown Board" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </button>
                    <button onClick={() => setBoardTheme('green')} style={{ background: 'none', padding: 0, border: boardTheme === 'green' ? '2px solid var(--primary)' : '2px solid transparent', borderRadius: '6px', opacity: boardTheme === 'green' ? 1 : 0.6, width: '45px', height: '45px', overflow: 'hidden', cursor: 'pointer' }}>
                      <img src="/Assets/Themes/Green Board.png" alt="Green Board" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </button>
                  </div>
                </div>

                <div style={styles.panelTabs}>
                  <button style={{ ...styles.tab, borderBottom: '2px solid var(--primary)', cursor: 'default' }}>
                    <History size={16} /> History
                  </button>
                </div>

                <div style={styles.panelContent}>
                  <div ref={historyContainerRef} style={styles.historySection}>
                    <div style={styles.moveList}>
                      {gameHistory.map((move: string, i: number) => {
                        const isHighlighted = (reviewIndex ?? gameHistory.length) === i + 1;
                        return (
                          <span key={i} style={{
                            ...styles.moveItem,
                            background: isHighlighted ? 'rgba(212, 175, 55, 0.2)' : 'transparent',
                            color: isHighlighted ? '#fff' : '#888',
                            padding: '2px 4px',
                            borderRadius: '4px'
                          }}>
                            {i + 1}. {move}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Action Center - Desktop */}
                <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid var(--glass-border)' }}>
                  <div style={{ height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem', textAlign: 'center' }}>
                    {takebackRequest && playerColor !== 'spectator' ? (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '0 10px', background: 'rgba(212, 175, 55, 0.1)', borderRadius: '20px', height: '100%' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 600 }}>Accept Takeback?</span>
                        <button onClick={() => respondToTakeback(true)} style={styles.inlineBtnSuccess}>Yes</button>
                        <button onClick={() => respondToTakeback(false)} style={styles.inlineBtnDanger}>No</button>
                      </div>
                    ) : drawRequest && playerColor !== 'spectator' ? (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '0 10px', background: 'rgba(212, 175, 55, 0.1)', borderRadius: '20px', height: '100%' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 600 }}>Accept Draw?</span>
                        <button onClick={() => respondToDraw(true)} style={styles.inlineBtnSuccess}>Yes</button>
                        <button onClick={() => respondToDraw(false)} style={styles.inlineBtnDanger}>No</button>
                      </div>
                    ) : confirmAction === 'resign' ? (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '0 10px', background: 'rgba(244, 67, 54, 0.1)', borderRadius: '20px', height: '100%' }}>
                        <span style={{ fontSize: '0.85rem', color: '#f44336', fontWeight: 600 }}>Resign?</span>
                        <button onClick={() => { resign(); setConfirmAction(null); }} style={styles.inlineBtnDanger}>Confirm</button>
                        <button onClick={() => setConfirmAction(null)} style={styles.inlineBtnGhost}>Cancel</button>
                      </div>
                    ) : confirmAction === 'draw' ? (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '0 10px', background: 'rgba(212, 175, 55, 0.1)', borderRadius: '20px', height: '100%' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 600 }}>Offer Draw?</span>
                        <button onClick={() => { offerDraw(); setConfirmAction(null); }} style={styles.inlineBtnSuccess}>Confirm</button>
                        <button onClick={() => setConfirmAction(null)} style={styles.inlineBtnGhost}>Cancel</button>
                      </div>
                    ) : status.includes('Rejected') ? (
                      <span style={{ fontSize: '0.9rem', color: status.includes('Draw') ? 'var(--primary)' : '#f44336', fontWeight: 700, textTransform: 'uppercase' }}>{status}</span>
                    ) : outcome ? (
                      <span style={{ fontSize: '0.9rem', color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase' }}>{outcome}</span>
                    ) : (participants.length < 2 && gameHistory.length > 0) ? (
                      <span style={{ fontSize: '0.9rem', color: '#f44336', fontWeight: 700 }}>Opponent Left!</span>
                    ) : isGameOver ? (
                      <span style={{ fontSize: '0.9rem', color: '#fff', fontWeight: 700 }}>
                        {isCheckmate ? `Checkmate! ${turn === 'b' ? 'White' : 'Black'} won` : isDraw ? "Draw!" : "Game Over"}
                      </span>
                    ) : gameHistory.length === 0 ? (
                      <span style={{ fontSize: '0.85rem', color: '#888' }}>Waiting for a move...</span>
                    ) : (
                      <span style={{ fontSize: '0.85rem', color: '#ccc' }}>
                        Last move: <strong style={{ color: '#fff' }}>{gameHistory[gameHistory.length - 1]}</strong>
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4px' }}>
                    <button onClick={() => setConfirmAction(confirmAction === 'resign' ? null : 'resign')} disabled={isGameOver || playerColor === 'spectator' || drawPending || drawRequest || takebackPending || takebackRequest || confirmAction === 'draw'} style={{ ...styles.controlBtn, background: confirmAction === 'resign' ? 'rgba(244, 67, 54, 0.2)' : styles.controlBtn.background, borderColor: confirmAction === 'resign' ? '#f44336' : 'var(--glass-border)', opacity: (isGameOver || playerColor === 'spectator' || drawPending || drawRequest || takebackPending || takebackRequest || confirmAction === 'draw') ? 0.3 : 1 }} title="Resign"><Flag size={20} /></button>
                    <button onClick={() => { if (drawPending) cancelDraw(); else setConfirmAction(confirmAction === 'draw' ? null : 'draw'); }} disabled={isGameOver || playerColor === 'spectator' || takebackPending || takebackRequest || confirmAction === 'resign'} style={{ ...styles.controlBtn, background: (confirmAction === 'draw' || drawPending) ? 'rgba(212, 175, 55, 0.4)' : styles.controlBtn.background, borderColor: (confirmAction === 'draw' || drawPending) ? 'var(--primary)' : 'var(--glass-border)', opacity: (isGameOver || playerColor === 'spectator' || takebackPending || takebackRequest || confirmAction === 'resign') ? 0.3 : 1 }} title={drawPending ? "Cancel Offer" : "Suggest Draw"}>{drawPending ? <X size={20} /> : <Handshake size={20} />}</button>
                    <button onClick={() => setReviewIndex(prev => Math.max(0, (prev ?? gameHistory.length) - 1))} disabled={reviewIndex === 0} style={{ ...styles.controlBtn, opacity: reviewIndex === 0 ? 0.3 : 1 }} title="Previous Move"><ChevronLeft size={20} /></button>
                    <button onClick={() => setReviewIndex(prev => {
                      const next = (prev ?? gameHistory.length) + 1;
                      return next > gameHistory.length ? null : next;
                    })} disabled={reviewIndex === null} style={{ ...styles.controlBtn, opacity: reviewIndex === null ? 0.3 : 1 }} title="Next Move"><ChevronRight size={20} /></button>
                    <button onClick={() => { if (takebackPending) cancelTakeback(); else requestTakeback(); }} disabled={playerColor === 'spectator' || gameHistory.length === 0 || drawPending || drawRequest || confirmAction === 'draw' || confirmAction === 'resign'} style={{ ...styles.controlBtn, background: takebackPending ? 'rgba(244, 67, 54, 0.2)' : styles.controlBtn.background, color: takebackPending ? '#f44336' : '#fff', opacity: (playerColor === 'spectator' || gameHistory.length === 0 || drawPending || drawRequest || confirmAction === 'draw' || confirmAction === 'resign') ? 0.3 : 1 }} title={takebackPending ? 'Cancel Request' : 'Request Takeback'}>{takebackPending ? <X size={20} /> : <Undo2 size={20} />}</button>
                  </div>
                </div>
              </aside>

              {isGameOver && playerColor !== 'spectator' && (
                <div style={{ marginTop: '20px', width: '100%' }}>
                  {rematchPending ? (
                    <div style={{ height: '80px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(244, 67, 54, 0.1)', border: '1px solid rgba(244, 67, 54, 0.1)', borderRadius: '8px' }}>
                      <span style={{ fontSize: '0.8rem', color: 'rgba(244, 67, 54, 0.6)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Rematch Requested</span>
                      <button onClick={cancelRematch} style={{ background: 'rgba(244, 67, 54, 0.2)', color: '#f44336', border: 'none', padding: '6px 16px', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 600 }}>Cancel</button>
                    </div>
                  ) : rematchRequest ? (
                    <div style={{ height: '80px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(76, 175, 80, 0.1)', border: '1px solid rgba(76, 175, 80, 0.1)', borderRadius: '8px' }}>
                      <span style={{ fontSize: '0.8rem', color: 'rgba(76, 175, 80, 0.7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Rematch Requested</span>
                      <div style={{ display: 'flex', gap: '12px' }}>
                        <button onClick={() => respondToRematch(true)} style={{ ...styles.inlineBtnSuccess, padding: '6px 16px' }}>Accept</button>
                        <button onClick={() => respondToRematch(false)} style={{ ...styles.inlineBtnDanger, padding: '6px 16px' }}>Decline</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={offerRematch} style={{ ...styles.mainBtn, background: '#f44336', borderRadius: '8px', height: '80px', fontSize: '1.1rem', fontWeight: 600, boxShadow: '0 4px 15px rgba(244, 67, 54, 0.3)', color: 'white', width: '100%' }}>Rematch</button>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* Mobile View */}
        {isMobile && (
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', maxWidth: '100%', gap: '16px' }}>

            {/* Board Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', width: '100%' }}>
              <PlayerBox role={oppColor} turn={turn} viewerRole={playerColor} isOpponent capturedPieces={oppColor === 'white' ? capturedPieces.white : capturedPieces.black} themeColor={activeTheme.box} />

              <div style={{ ...styles.boardWrapper, width: boardWidth, height: boardWidth, position: 'relative' }}>
                <Chessboard options={chessboardOptions} />

                {/* Promotion Overlay */}
                {pendingPromotion && (() => {
                  const sqSize = boardWidth / 8;
                  const file = pendingPromotion.to.charCodeAt(0) - 97;
                  const isWhitePromo = pendingPromotion.to[1] === '8';
                  const boardFlipped = playerColor === 'black';
                  const colFromLeft = boardFlipped ? (7 - file) : file;
                  const fromTop = (isWhitePromo && !boardFlipped) || (!isWhitePromo && boardFlipped);
                  const promoColor = isWhitePromo ? 'w' : 'b';
                  const pieces: { key: 'q' | 'r' | 'b' | 'n'; pieceKey: string }[] = [
                    { key: 'q', pieceKey: getPieceKey('q', promoColor as 'w' | 'b') },
                    { key: 'r', pieceKey: getPieceKey('r', promoColor as 'w' | 'b') },
                    { key: 'b', pieceKey: getPieceKey('b', promoColor as 'w' | 'b') },
                    { key: 'n', pieceKey: getPieceKey('n', promoColor as 'w' | 'b') },
                  ];

                  return (
                    <>
                      <div onClick={cancelPromotion} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10, borderRadius: '4px' }} />
                      <div style={{ position: 'absolute', left: colFromLeft * sqSize, top: fromTop ? 0 : undefined, bottom: fromTop ? undefined : 0, width: sqSize, zIndex: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.6)', borderRadius: '4px', overflow: 'hidden' }}>
                        {pieces.map((p) => {
                          const isLight = (colFromLeft + pieces.indexOf(p)) % 2 === (fromTop ? 0 : 1);
                          const PieceComponent = boardTheme === 'green' ? customGreenPieces[p.pieceKey] : defaultPieces[p.pieceKey];
                          return (
                            <button key={p.key} onClick={() => handlePromotionChoice(p.key)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: sqSize, height: sqSize, background: isLight ? activeTheme.light : activeTheme.dark, border: 'none', cursor: 'pointer', padding: sqSize * 0.08 }}>
                              {PieceComponent ? PieceComponent({}) : p.key}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </div>

              <PlayerBox role={playerColor === 'spectator' ? 'white' : playerColor} turn={turn} viewerRole={playerColor} capturedPieces={playerColor === 'white' ? capturedPieces.white : (playerColor === 'black' ? capturedPieces.black : capturedPieces.white)} themeColor={activeTheme.box} />
            </div>

            {/* Match Link (Mobile) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.3)', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', width: '100%' }}>
              <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.75rem', color: '#ccc', fontFamily: 'monospace' }}>{inviteUrl}</div>
              <button onClick={copyLink} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: linkCopied ? '#4caf50' : '#888', cursor: 'pointer', padding: '6px', borderRadius: '4px' }}>
                {linkCopied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>

            {/* Panel Section */}
            <aside className="glass" style={{ ...styles.panel, width: '100%', height: 'auto', minHeight: '300px' }}>

              {/* Action Center */}
              <div style={{ padding: '10px', background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid var(--glass-border)' }}>
                <div style={{ height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '8px', textAlign: 'center' }}>
                  {takebackRequest && playerColor !== 'spectator' ? (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '0 10px', background: 'rgba(212, 175, 55, 0.1)', borderRadius: '20px', height: '100%' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>Accept Takeback?</span>
                      <button onClick={() => respondToTakeback(true)} style={styles.inlineBtnSuccess}>Yes</button>
                      <button onClick={() => respondToTakeback(false)} style={styles.inlineBtnDanger}>No</button>
                    </div>
                  ) : drawRequest && playerColor !== 'spectator' ? (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '0 10px', background: 'rgba(212, 175, 55, 0.1)', borderRadius: '20px', height: '100%' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>Accept Draw?</span>
                      <button onClick={() => respondToDraw(true)} style={styles.inlineBtnSuccess}>Yes</button>
                      <button onClick={() => respondToDraw(false)} style={styles.inlineBtnDanger}>No</button>
                    </div>
                  ) : confirmAction === 'resign' ? (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '0 10px', background: 'rgba(244, 67, 54, 0.1)', borderRadius: '20px', height: '100%' }}>
                      <span style={{ fontSize: '0.8rem', color: '#f44336', fontWeight: 600 }}>Resign?</span>
                      <button onClick={() => { resign(); setConfirmAction(null); }} style={styles.inlineBtnDanger}>Confirm</button>
                      <button onClick={() => setConfirmAction(null)} style={styles.inlineBtnGhost}>Cancel</button>
                    </div>
                  ) : confirmAction === 'draw' ? (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '0 10px', background: 'rgba(212, 175, 55, 0.1)', borderRadius: '20px', height: '100%' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>Offer Draw?</span>
                      <button onClick={() => { offerDraw(); setConfirmAction(null); }} style={styles.inlineBtnSuccess}>Confirm</button>
                      <button onClick={() => setConfirmAction(null)} style={styles.inlineBtnGhost}>Cancel</button>
                    </div>
                  ) : status.includes('Rejected') ? (
                    <span style={{ fontSize: '0.85rem', color: status.includes('Draw') ? 'var(--primary)' : '#f44336', fontWeight: 700, textTransform: 'uppercase' }}>{status}</span>
                  ) : outcome ? (
                    <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase' }}>{outcome}</span>
                  ) : isGameOver ? (
                    <span style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 700 }}>{isCheckmate ? `Checkmate!` : "Game Over"}</span>
                  ) : gameHistory.length === 0 ? (
                    <span style={{ fontSize: '0.8rem', color: '#888' }}>Waiting for move...</span>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: '#ccc' }}>Last move: <strong>{gameHistory[gameHistory.length - 1]}</strong></span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => setConfirmAction(confirmAction === 'resign' ? null : 'resign')}
                    disabled={isGameOver || playerColor === 'spectator' || drawPending || drawRequest || takebackPending || takebackRequest || confirmAction === 'draw'}
                    style={{
                      ...styles.controlBtn,
                      height: '36px',
                      background: confirmAction === 'resign' ? 'rgba(244, 67, 54, 0.2)' : styles.controlBtn.background,
                      borderColor: confirmAction === 'resign' ? '#f44336' : 'var(--glass-border)',
                      opacity: (isGameOver || playerColor === 'spectator' || drawPending || drawRequest || takebackPending || takebackRequest || confirmAction === 'draw') ? 0.3 : 1
                    }}
                    title="Resign"
                  >
                    <Flag size={18} />
                  </button>
                  <button
                    onClick={() => { if (drawPending) cancelDraw(); else setConfirmAction(confirmAction === 'draw' ? null : 'draw'); }}
                    disabled={isGameOver || playerColor === 'spectator' || takebackPending || takebackRequest || confirmAction === 'resign'}
                    style={{
                      ...styles.controlBtn,
                      height: '36px',
                      background: (confirmAction === 'draw' || drawPending) ? 'rgba(212, 175, 55, 0.4)' : styles.controlBtn.background,
                      borderColor: (confirmAction === 'draw' || drawPending) ? 'var(--primary)' : 'var(--glass-border)',
                      opacity: (isGameOver || playerColor === 'spectator' || takebackPending || takebackRequest || confirmAction === 'resign') ? 0.3 : 1
                    }}
                    title={drawPending ? "Cancel Offer" : "Suggest Draw"}
                  >
                    {drawPending ? <X size={18} /> : <Handshake size={18} />}
                  </button>
                  <button onClick={() => setReviewIndex(prev => Math.max(0, (prev ?? gameHistory.length) - 1))} disabled={reviewIndex === 0} style={{ ...styles.controlBtn, height: '36px', opacity: reviewIndex === 0 ? 0.3 : 1 }} title="Prev"><ChevronLeft size={18} /></button>
                  <button
                    onClick={() => setReviewIndex(prev => {
                      const next = (prev ?? gameHistory.length) + 1;
                      return next > gameHistory.length ? null : next;
                    })}
                    disabled={reviewIndex === null}
                    style={{ ...styles.controlBtn, height: '36px', opacity: reviewIndex === null ? 0.3 : 1 }}
                    title="Next"
                  >
                    <ChevronRight size={18} />
                  </button>
                  <button
                    onClick={() => { if (takebackPending) cancelTakeback(); else requestTakeback(); }}
                    disabled={playerColor === 'spectator' || gameHistory.length === 0 || drawPending || drawRequest || confirmAction === 'draw' || confirmAction === 'resign'}
                    style={{
                      ...styles.controlBtn,
                      height: '36px',
                      background: takebackPending ? 'rgba(244, 67, 54, 0.2)' : styles.controlBtn.background,
                      color: takebackPending ? '#f44336' : '#fff',
                      opacity: (playerColor === 'spectator' || gameHistory.length === 0 || drawPending || drawRequest || confirmAction === 'draw' || confirmAction === 'resign') ? 0.3 : 1
                    }}
                    title={takebackPending ? 'Cancel Request' : 'Request Takeback'}
                  >
                    {takebackPending ? <X size={18} /> : <Undo2 size={18} />}
                  </button>
                </div>
              </div>

              {/* Mobile Board Theme Selector */}
              <div style={{ padding: '10px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'center', gap: '20px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: '#888', fontWeight: 600, textTransform: 'uppercase' }}>Theme</span>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => setBoardTheme('brown')} style={{ background: 'none', padding: 0, border: boardTheme === 'brown' ? '2px solid var(--primary)' : '2px solid transparent', borderRadius: '4px', width: '32px', height: '32px', overflow: 'hidden' }}><img src="/Assets/Themes/Brown Board.png" style={{ width: '100%', height: '100%' }} /></button>
                  <button onClick={() => setBoardTheme('green')} style={{ background: 'none', padding: 0, border: boardTheme === 'green' ? '2px solid var(--primary)' : '2px solid transparent', borderRadius: '4px', width: '32px', height: '32px', overflow: 'hidden' }}><img src="/Assets/Themes/Green Board.png" style={{ width: '100%', height: '100%' }} /></button>
                </div>
              </div>

              {/* Tabs Toggle */}
              <div style={styles.panelTabs}>
                <button
                  onClick={() => setActiveTabMobile('history')}
                  style={{ ...styles.tab, borderBottom: activeTabMobile === 'history' ? '2px solid var(--primary)' : 'none', color: activeTabMobile === 'history' ? '#fff' : '#888' }}
                >
                  <History size={16} /> History
                </button>
                <button
                  onClick={() => setActiveTabMobile('chat')}
                  style={{ ...styles.tab, borderBottom: activeTabMobile === 'chat' ? '2px solid var(--primary)' : 'none', color: activeTabMobile === 'chat' ? '#fff' : '#888' }}
                >
                  <MessageSquare size={16} /> Chat
                </button>
              </div>

              {/* Content area */}
              <div style={{ height: '240px', overflow: 'hidden' }}>
                {activeTabMobile === 'chat' ? (
                  <div style={styles.chatSection}>
                    <div ref={chatContainerRef} style={{ ...styles.messages, padding: '10px' }}>
                      {chatMessages.map((msg: ChatMessage) => (
                        <div key={msg.id} style={{ ...styles.msg, padding: '4px 8px', fontSize: '0.85rem' }}>
                          <strong style={{ color: msg.role === 'white' ? '#fff' : (msg.role === 'spectator' ? '#739552' : 'var(--primary)') }}>
                            {msg.role === playerColor ? 'You' : (['white', 'black'].includes(msg.role) ? 'Opponent' : msg.role.charAt(0).toUpperCase() + msg.role.slice(1))}:
                          </strong> {msg.text}
                        </div>
                      ))}
                    </div>
                    <div style={{ ...styles.chatInputWrapper, padding: '8px' }}>
                      <input
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyPress={(e) => { if (e.key === 'Enter' && chatInput.trim()) { sendMessage(chatInput.trim()); setChatInput(''); } }}
                        placeholder="Type a message..."
                        style={{ ...styles.chatInput, padding: '8px 12px', fontSize: '0.85rem' }}
                      />
                    </div>
                  </div>
                ) : (
                  <div ref={historyContainerRef} style={{ ...styles.historySection, padding: '10px' }}>
                    <div style={{ ...styles.moveList, gridTemplateColumns: '1fr 1fr 1fr' }}>
                      {gameHistory.map((move: string, i: number) => {
                        const isHighlighted = (reviewIndex ?? gameHistory.length) === i + 1;
                        return (
                          <span key={i} style={{
                            ...styles.moveItem,
                            fontSize: '0.8rem',
                            background: isHighlighted ? 'rgba(212, 175, 55, 0.2)' : 'transparent',
                            color: isHighlighted ? '#fff' : '#888',
                            padding: '2px'
                          }}>
                            {i + 1}. {move}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>


              {/* Mobile Rematch / New Game Button (Embedded in Panel) */}
              {isGameOver && playerColor !== 'spectator' && (
                <div style={{ padding: '10px', borderTop: '1px solid var(--glass-border)' }}>
                  {rematchPending ? (
                    <button onClick={cancelRematch} style={{ ...styles.mainBtn, height: '50px', background: 'rgba(244, 67, 54, 0.2)', color: '#f44336' }}>Cancel Rematch</button>
                  ) : rematchRequest ? (
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button onClick={() => respondToRematch(true)} style={{ ...styles.mainBtn, height: '50px', flex: 1, background: '#4caf50' }}>Accept</button>
                      <button onClick={() => respondToRematch(false)} style={{ ...styles.mainBtn, height: '50px', flex: 1, background: '#f44336' }}>Decline</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button onClick={offerRematch} style={{ ...styles.mainBtn, height: '50px', flex: 1, background: '#f44336' }}>Rematch</button>
                      <button onClick={() => window.location.href = `/game/${nanoid(10)}`} style={{ ...styles.mainBtn, height: '50px', flex: 1, background: '#4caf50' }}>New Game</button>
                    </div>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}
      </main>


      <AnimatePresence>
        {/* Finish logic */}
      </AnimatePresence>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { height: '50px', padding: '0 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.5)', borderBottom: '1px solid var(--glass-border)', flexShrink: 0, userSelect: 'none' },
  logo: { fontSize: '1.5rem', fontWeight: 700 },
  gameInfo: { display: 'flex', alignItems: 'center', gap: '1.5rem' },
  statusBadge: { display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#888', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid var(--glass-border)', transition: 'all 0.3s ease' },
  participantsBox: { display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: '#888', background: 'rgba(255,255,255,0.05)', padding: '0.4rem 0.8rem', borderRadius: '20px' },
  dot: { width: '8px', height: '8px', borderRadius: '50%' },
  iconBtn: { background: 'transparent', color: '#888', display: 'flex', alignItems: 'center', padding: '0.5rem' },
  main: { flex: 1, display: 'flex', padding: '31px 1rem 48px 1rem', gap: '32px', maxWidth: '100%', margin: '0', width: '100%', flexWrap: 'nowrap', justifyContent: 'center', alignItems: 'flex-start' },
  boardContainer: { display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center', transition: 'width 0.3s ease' },
  boardHeader: { width: '100%', display: 'flex', justifyContent: 'center' },
  boardFooter: { width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  boardWrapper: { boxShadow: '0 20px 50px rgba(0,0,0,0.5)', cursor: 'pointer', background: 'var(--glass-bg)' },
  playerBox: { borderRadius: '12px', border: '1px solid var(--glass-border)', width: '100%', height: '58px', display: 'flex', alignItems: 'center', padding: '0 1rem', position: 'relative', userSelect: 'none' },
  avatar: { width: '32px', height: '32px', borderRadius: '6px', display: 'flex', alignItems: 'center', fontWeight: 'bold', fontSize: '0.9rem', transition: 'all 0.3s ease', justifyContent: 'center' },
  playerInfo: { display: 'flex', flexDirection: 'column' },
  playerName: { fontSize: '0.8rem', fontWeight: '600', color: '#fff', userSelect: 'none' },
  statusBadgeSmall: { fontSize: '0.6rem', fontWeight: '600', color: 'var(--primary)', background: 'rgba(212, 175, 55, 0.1)', padding: '0.1rem 0.3rem', borderRadius: '4px', border: '1px solid rgba(212, 175, 55, 0.2)' },
  actions: { display: 'flex', gap: '0.5rem' },
  actionBtn: { background: '#2a2a2a', color: '#fff', padding: '0.4rem', borderRadius: '8px' },
  panel: { width: '260px', flexShrink: 0, display: 'flex', flexDirection: 'column', transition: 'height 0.3s ease', userSelect: 'none', overflow: 'hidden' },
  panelTabs: { display: 'flex', borderBottom: '1px solid var(--glass-border)' },
  tab: { flex: 1, padding: '1rem', background: 'transparent', color: '#888', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', borderRadius: 0, userSelect: 'none' },
  panelContent: { flex: 1, overflow: 'hidden' },
  chatSection: { display: 'flex', flexDirection: 'column', height: '100%' },
  messages: { flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  msg: { fontSize: '0.9rem', background: 'rgba(255,255,255,0.03)', padding: '0.5rem 0.8rem', borderRadius: '8px', userSelect: 'none' },
  msgRole: { fontWeight: 700, marginRight: '0.5rem' },
  chatInputWrapper: { padding: '1rem', borderTop: '1px solid var(--glass-border)' },
  chatInput: { width: '100%', padding: '0.8rem 1rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: '#fff', outline: 'none' },
  historySection: { padding: '1rem', height: '100%', overflowY: 'auto' },
  moveList: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' },
  moveItem: { fontSize: '0.9rem', color: '#888', userSelect: 'none' },
  toast: { position: 'fixed', bottom: '2rem', right: '2rem', padding: '1.5rem', zIndex: 1000, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' },
  toastBtns: { display: 'flex', gap: '1rem', marginTop: '1rem' },
  toastBtnYes: { background: 'var(--primary)', color: 'black', padding: '0.5rem 1rem' },
  toastBtnNo: { background: 'transparent', border: '1px solid #f44336', color: '#f44336', padding: '0.5rem 1rem' },
  gameOverOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '2rem' },
  gameOverCard: { padding: '3rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', maxWidth: '400px', width: '100%' },
  mainBtn: { background: 'var(--primary)', color: 'black', padding: '1rem 2rem', width: '100%', fontSize: '1.1rem' },
  controlBtn: {
    flex: 1,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--glass-border)',
    borderRadius: '8px',
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    transition: 'all 0.2s ease',
    cursor: 'pointer',
    userSelect: 'none'
  },
  inlineBtnSuccess: { background: '#4caf50', border: 'none', color: 'white', padding: '4px 12px', fontSize: '0.75rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 },
  inlineBtnDanger: { background: '#f44336', border: 'none', color: 'white', padding: '4px 12px', fontSize: '0.75rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 },
  inlineBtnGhost: { background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', padding: '4px 12px', fontSize: '0.75rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 },
};