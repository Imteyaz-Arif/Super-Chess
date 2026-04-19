import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Chess, Move } from 'chess.js';
import * as Ably from 'ably';
import { Realtime } from 'ably';

export type PlayerColor = 'white' | 'black' | 'spectator';

export interface ChatMessage {
  role: string;
  text: string;
  id: string;
}

interface GameStatePayload {
  pgn: string;
}

interface TakebackResponsePayload {
  accepted: boolean;
  pgn?: string;
}

interface DrawResponsePayload {
  accepted: boolean;
}

const SOUNDS = {
  moveSelf: '/Assets/Sounds/Self Move.mp3',
  moveOpponent: '/Assets/Sounds/Opponent Move.mp3',
  capture: '/Assets/Sounds/Capture.mp3',
  check: '/Assets/Sounds/Check.mp3',
  castle: '/Assets/Sounds/Castle.mp3',
  illegal: '/Assets/Sounds/Illegal Move.mp3',
  promote: '/Assets/Sounds/Promote.mp3',
  gameStart: '/Assets/Sounds/Game Start.mp3',
  gameEnd: '/Assets/Sounds/Game End.mp3'
};

// Audio
const audioCache: Record<string, HTMLAudioElement> = {};

export const playAudio = (key: keyof typeof SOUNDS) => {
  if (typeof window === 'undefined') return;

  try {
    if (!audioCache[key]) {
      audioCache[key] = new Audio(SOUNDS[key]);
      audioCache[key].volume = 0.6;
    }

    const sound = audioCache[key];
    sound.currentTime = 0;
    sound.play().catch(() => {
      // Handle playback blocking
    });
  } catch (_err) {
    // Error handling
  }
};

interface UseChessGameProps {
  gameId: string;
  initialPlayerColor?: PlayerColor;
}

// Ably
let globalAblyClient: Realtime | null = null;

export const useChessGame = ({ gameId }: UseChessGameProps) => {
  const [game, setGame] = useState(new Chess());
  const [fen, setFen] = useState(game.fen());
  const [playerColor, setPlayerColor] = useState<PlayerColor>('spectator');

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const [status, setStatus] = useState<string>('Connecting...');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [takebackRequest, setTakebackRequest] = useState<boolean>(false);
  const [takebackPending, setTakebackPending] = useState<boolean>(false);
  const [drawRequest, setDrawRequest] = useState<boolean>(false);
  const [drawPending, setDrawPending] = useState<boolean>(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Ably.PresenceMessage[]>([]);
  const [rematchRequest, setRematchRequest] = useState<boolean>(false);
  const [rematchPending, setRematchPending] = useState<boolean>(false);

  // State
  const pendingStatesRef = useRef({
    takebackRequest,
    takebackPending,
    drawRequest,
    drawPending,
  });

  useEffect(() => {
    pendingStatesRef.current = {
      takebackRequest,
      takebackPending,
      drawRequest,
      drawPending,
    };
  }, [takebackRequest, takebackPending, drawRequest, drawPending]);

  // Audio
  const triggerMoveSound = useCallback((move: Move, isOpponent = false) => {
    if (move.san.includes('#')) playAudio('gameEnd');
    else if (move.san.includes('+')) playAudio('check');
    else if (move.captured) playAudio('capture');
    else if (move.flags.includes('k') || move.flags.includes('q')) playAudio('castle');
    else if (move.flags.includes('p')) playAudio('promote');
    else playAudio(isOpponent ? 'moveOpponent' : 'moveSelf');
  }, []);

  const ablyClientRef = useRef<Realtime | null>(null);
  const channelRef = useRef<Ably.RealtimeChannel | null>(null);
  const playerColorRef = useRef<PlayerColor>('spectator');
  const gameRef = useRef<Chess>(game);
  const lastMoveTimeRef = useRef<number>(0);

  // Refs
  useEffect(() => {
    gameRef.current = game;
  }, [game]);
  useEffect(() => {
    playerColorRef.current = playerColor;
  }, [playerColor]);

  // Game
  const loadFromPgn = useCallback((pgn: string) => {
    const newGame = new Chess();
    if (pgn) {
      newGame.loadPgn(pgn);
    }
    setGame(newGame);
    setFen(newGame.fen());
  }, []);

  // Initialization
  useEffect(() => {
    let isMounted = true;

    // Identity
    let myClientId: string | null = null;
    if (typeof window !== 'undefined') {
      myClientId = localStorage.getItem('chess-user-id');
      if (!myClientId) {
        myClientId = 'user-' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('chess-user-id', myClientId);
      }
    }

    if (!globalAblyClient) {
      globalAblyClient = new Realtime({
        authUrl: `/api/ably/auth?clientId=${myClientId}`,
        clientId: myClientId || undefined
      });
    }
    const client = globalAblyClient;
    ablyClientRef.current = client;

    const gameChannel = client.channels.get(`chess-game-${gameId}`);
    channelRef.current = gameChannel;

    // Presence
    const initPresence = async () => {
      try {
        const members = await gameChannel.presence.get() as Ably.PresenceMessage[];
        if (!isMounted) return;
        setParticipants(members);

        let finalColor: PlayerColor = 'spectator';
        const storedColor = localStorage.getItem(`chess-game-${gameId}-role`);

        const whiteExists = members.some((m: Ably.PresenceMessage) => m.data?.color === 'white');
        const blackExists = members.some((m: Ably.PresenceMessage) => m.data?.color === 'black');

        if (storedColor === 'white' && !whiteExists) {
          finalColor = 'white';
        } else if (storedColor === 'black' && !blackExists) {
          finalColor = 'black';
        } else {
          if (!whiteExists) finalColor = 'white';
          else if (!blackExists) finalColor = 'black';

          if (finalColor !== 'spectator') {
            localStorage.setItem(`chess-game-${gameId}-role`, finalColor);
          }
        }

        if (!isMounted) return;
        setPlayerColor(finalColor);

        await gameChannel.presence.enter({ color: finalColor });
      } catch {
        // Error handling
      }
    };

    // History
    const fetchHistory = async () => {
      try {
        const resultPage = await gameChannel.history({ limit: 100 });
        const messages = resultPage.items;

        const chatHistory = messages
          .filter(m => m.name === 'chat')
          .reverse()
          .map(m => m.data);

        if (isMounted && chatHistory.length > 0) {
          setChatMessages(chatHistory);
        }
      } catch {
        // Error handling
      }
    };

    // Listeners
    gameChannel.subscribe('game-state', (message: Ably.InboundMessage) => {
      const { pgn } = message.data as GameStatePayload;
      const currentGame = gameRef.current;
      const oldPgn = currentGame.pgn();
      if (pgn === oldPgn || !isMounted) return;

      const oldHistory = currentGame.history();
      const newGame = new Chess();
      newGame.loadPgn(pgn);
      const newHistory = newGame.history({ verbose: true });
      loadFromPgn(pgn);

      const { takebackPending: tp, takebackRequest: tr, drawPending: dp, drawRequest: dr } = pendingStatesRef.current;
      const isSpectator = playerColorRef.current === 'spectator';

      if (!isSpectator) {
        if (tp || tr) {
          setStatus('Takeback Rejected!');
          setTimeout(() => { if (isMounted) setStatus('Connected'); }, 1000);
        }
        if (dp || dr) {
          setStatus('Draw Rejected!');
          setTimeout(() => { if (isMounted) setStatus('Connected'); }, 1000);
        }
      }

      setTakebackRequest(false);
      setTakebackPending(false);
      setDrawRequest(false);
      setDrawPending(false);

      if (newHistory.length > oldHistory.length) {
        const lastMove = newHistory[newHistory.length - 1];
        triggerMoveSound(lastMove, true);
      }
    });

    gameChannel.subscribe('state-request', () => {
      if (playerColorRef.current !== 'spectator' && isMounted) {
        const pgn = gameRef.current.pgn();
        if (pgn !== '') gameChannel.publish('game-state', { pgn });
      }
    });

    gameChannel.subscribe('chat', (message) => {
      if (isMounted) setChatMessages((prev) => [...prev, message.data]);
    });

    gameChannel.subscribe('reset-game', () => {
      if (isMounted) {
        const newGame = new Chess();
        setGame(newGame);
        setFen(newGame.fen());
        setOutcome(null);
        setTakebackRequest(false);
        setTakebackPending(false);
        setDrawRequest(false);
        setDrawPending(false);
        setRematchRequest(false);
        setRematchPending(false);
        localStorage.removeItem(`chess-game-${gameId}-pgn`);
      }
    });

    gameChannel.presence.subscribe(['enter', 'leave', 'present', 'update'], async () => {
      try {
        const members = await gameChannel.presence.get() as Ably.PresenceMessage[];
        if (isMounted) setParticipants(members);

        if (playerColorRef.current === 'spectator') {
          const whiteExists = members.some(m => m.data?.color === 'white');
          const blackExists = members.some(m => m.data?.color === 'black');
          let newColor: PlayerColor = 'spectator';

          if (!whiteExists) newColor = 'white';
          else if (!blackExists) newColor = 'black';

          if (newColor !== 'spectator') {
            localStorage.setItem(`chess-game-${gameId}-role`, newColor);
            if (isMounted) {
              setPlayerColor(newColor);
              gameChannel.presence.update({ color: newColor });
            }
          }
        }
      } catch {
        // Error handling
      }
    });

    initPresence().then(() => {
      if (isMounted) {
        if (playerColorRef.current !== 'spectator') {
          gameChannel.publish('reset-game', {});
        } else {
          gameChannel.publish('state-request', {});
        }
        fetchHistory();
      }
    });

    gameChannel.subscribe('takeback-request', (message) => {
      if (message.clientId !== client.auth.clientId && isMounted) {
        setTakebackRequest(true);
      }
    });

    gameChannel.subscribe('takeback-response', (message: Ably.InboundMessage) => {
      const { accepted, pgn } = message.data as TakebackResponsePayload;
      if (!isMounted) return;

      if (!accepted && playerColorRef.current !== 'spectator') {
        setStatus('Takeback Rejected!');
        setTimeout(() => { if (isMounted) setStatus('Connected'); }, 1000);
      }

      setTakebackRequest(false);
      setTakebackPending(false);

      if (accepted && pgn !== undefined) {
        const newGame = new Chess();
        newGame.loadPgn(pgn);
        setGame(newGame);
        setFen(newGame.fen());
        setOutcome(null);
      }
    });

    gameChannel.subscribe('takeback-cancel', () => {
      if (isMounted) {
        setTakebackRequest(false);
        setTakebackPending(false);
      }
    });

    gameChannel.subscribe('draw-offer', (message) => {
      if (message.clientId !== client.auth.clientId && isMounted) {
        setDrawRequest(true);
      }
    });

    gameChannel.subscribe('draw-response', (message: Ably.InboundMessage) => {
      const { accepted } = message.data as DrawResponsePayload;
      if (!isMounted) return;

      if (accepted) {
        setOutcome('DRAW!');
      } else if (playerColorRef.current !== 'spectator') {
        setStatus('Draw Rejected!');
        setTimeout(() => { if (isMounted) setStatus('Connected'); }, 1000);
      }
      setDrawRequest(false);
      setDrawPending(false);
    });

    gameChannel.subscribe('draw-cancel', () => {
      if (isMounted) {
        setDrawRequest(false);
        setDrawPending(false);
      }
    });

    gameChannel.subscribe('resign', (message) => {
      if (!isMounted) return;
      const { color } = message.data;
      setOutcome(`${color.charAt(0).toUpperCase() + color.slice(1)} Resigned!`);
    });

    gameChannel.subscribe('rematch-offer', (message) => {
      if (message.clientId !== client.auth.clientId && isMounted) {
        setRematchRequest(true);
      }
    });

    gameChannel.subscribe('rematch-response', (message) => {
      const { accepted } = message.data;
      if (!isMounted) return;

      if (accepted) {
        const newGame = new Chess();
        setGame(newGame);
        setFen(newGame.fen());
        setOutcome(null);
      }
      setRematchRequest(false);
      setRematchPending(false);
    });

    gameChannel.subscribe('rematch-cancel', () => {
      if (isMounted) {
        setRematchRequest(false);
        setRematchPending(false);
      }
    });

    client.connection.on('connected', () => {
      if (isMounted) {
        setStatus('Connected');
        playAudio('gameStart');
      }
    });
    client.connection.on('failed', () => isMounted && setStatus('Connection Failed'));
    client.connection.on('disconnected', () => isMounted && setStatus('Disconnected'));
    client.connection.on('suspended', () => isMounted && setStatus('Suspended'));
    client.connection.on('closed', () => isMounted && setStatus('Closed'));

    return () => {
      isMounted = false;
      const client = ablyClientRef.current;
      if (client) {
        try {
          client.connection.off();
          if (gameChannel.state === 'attached' || gameChannel.state === 'attaching') {
            gameChannel.presence.leave().catch(() => { });
          }
          gameChannel.unsubscribe();
        } catch (e) {
          // Error cleanup
        }
      }
      channelRef.current = null;
      ablyClientRef.current = null;
    };
  }, [gameId, triggerMoveSound, loadFromPgn]);

  // Handlers
  const makeMove = useCallback((move: string | { from: string; to: string; promotion?: string }) => {
    try {
      if (typeof move === 'object' && move.from === move.to) return null;
      const currentGame = gameRef.current;
      const result = currentGame.move(move);
      if (result) {
        lastMoveTimeRef.current = Date.now();
        triggerMoveSound(result, false);
        if (channelRef.current) {
          const updatedGame = new Chess();
          updatedGame.loadPgn(currentGame.pgn());
          setGame(updatedGame);
          setFen(updatedGame.fen());

          // Auto-expire requests
          const { takebackPending: tp, takebackRequest: tr, drawPending: dp, drawRequest: dr } = pendingStatesRef.current;
          // Request handling

          setTakebackRequest(false);
          setTakebackPending(false);
          setDrawRequest(false);
          setDrawPending(false);

          setTakebackRequest(false);
          setTakebackPending(false);
          setDrawRequest(false);
          setDrawPending(false);

          channelRef.current.publish('game-state', { pgn: updatedGame.pgn() });
        }
        return result;
      } else {
        const now = Date.now();
        if (now - lastMoveTimeRef.current > 250) playAudio('illegal');
      }
    } catch (err) {
      const now = Date.now();
      if (now - lastMoveTimeRef.current > 250) playAudio('illegal');
      return null;
    }
    return null;
  }, [triggerMoveSound]);

  const sendMessage = (text: string) => {
    if (channelRef.current) {
      const msg = { role: playerColor, text, id: Math.random().toString(36).substr(2, 9) };
      channelRef.current.publish('chat', msg);
    }
  };

  const requestTakeback = () => {
    if (channelRef.current && !takebackPending) {
      channelRef.current.publish('takeback-request', {});
      setTakebackPending(true);
    }
  };

  const respondToTakeback = (accepted: boolean) => {
    if (channelRef.current) {
      if (accepted) {
        const currentGame = gameRef.current;
        currentGame.undo();
        const updatedGame = new Chess();
        updatedGame.loadPgn(currentGame.pgn());
        setGame(updatedGame);
        setFen(updatedGame.fen());
        channelRef.current.publish('takeback-response', { accepted: true, pgn: updatedGame.pgn() });
        setOutcome(null);
      } else {
        setStatus('Takeback Rejected!');
        setTimeout(() => { if (isMountedRef.current) setStatus('Connected'); }, 1000);
        channelRef.current.publish('takeback-response', { accepted: false });
      }
      setTakebackRequest(false);
      setTakebackPending(false);
    }
  };

  const cancelTakeback = () => {
    if (channelRef.current && takebackPending) {
      channelRef.current.publish('takeback-cancel', {});
      setTakebackPending(false);
    }
  };

  const offerDraw = () => {
    if (channelRef.current && !drawPending && !outcome && !game.isGameOver()) {
      channelRef.current.publish('draw-offer', {});
      setDrawPending(true);
    }
  };

  const respondToDraw = (accepted: boolean) => {
    if (channelRef.current) {
      if (accepted) {
        setOutcome('DRAW!');
        channelRef.current.publish('draw-response', { accepted: true });
      } else {
        setStatus('Draw Rejected!');
        setTimeout(() => { if (isMountedRef.current) setStatus('Connected'); }, 1000);
        channelRef.current.publish('draw-response', { accepted: false });
      }
      setDrawRequest(false);
      setDrawPending(false);
    }
  };

  const cancelDraw = () => {
    if (channelRef.current && drawPending) {
      channelRef.current.publish('draw-cancel', {});
      setDrawPending(false);
    }
  };

  const resign = useCallback(() => {
    if (channelRef.current && playerColorRef.current !== 'spectator') {
      channelRef.current.publish('resign', { color: playerColorRef.current });
      setOutcome(`${playerColorRef.current.charAt(0).toUpperCase() + playerColorRef.current.slice(1)} Resigned!`);
    }
  }, []);

  const offerRematch = useCallback(() => {
    if (channelRef.current) {
      setRematchPending(true);
      channelRef.current.publish('rematch-offer', {});
    }
  }, []);

  const respondToRematch = useCallback((accepted: boolean) => {
    if (channelRef.current) {
      channelRef.current.publish('rematch-response', { accepted });
      if (accepted) {
        const newGame = new Chess();
        setGame(newGame);
        setFen(newGame.fen());
        setOutcome(null);
        channelRef.current.publish('game-state', { pgn: '' });
      }
      setRematchRequest(false);
      setRematchPending(false);
    }
  }, []);

  const cancelRematch = useCallback(() => {
    if (channelRef.current && rematchPending) {
      channelRef.current.publish('rematch-cancel', {});
      setRematchPending(false);
    }
  }, [rematchPending]);

  const capturedPieces = useMemo(() => {
    const white: string[] = [];
    const black: string[] = [];
    const history = game.history({ verbose: true });
    for (const move of history) {
      if (move.captured) {
        if (move.color === 'w') white.push(move.captured);
        else black.push(move.captured);
      }
    }
    return { white, black };
  }, [game]);

  return {
    game,
    fen,
    makeMove,
    playerColor,
    setPlayerColor,
    status,
    chatMessages,
    sendMessage,
    takebackRequest,
    takebackPending,
    requestTakeback,
    respondToTakeback,
    cancelTakeback,
    drawRequest,
    drawPending,
    offerDraw,
    respondToDraw,
    cancelDraw,
    offerRematch,
    respondToRematch,
    cancelRematch,
    rematchRequest,
    rematchPending,
    resign,
    outcome,
    participants,
    capturedPieces,
    isCheck: game.isCheck(),
    isCheckmate: game.isCheckmate(),
    isDraw: game.isDraw(),
    isGameOver: game.isGameOver() || !!outcome,
    turn: game.turn(),
  };
};