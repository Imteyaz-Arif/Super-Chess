import { useState, useEffect } from 'react';
import * as Ably from 'ably';
import { getAblyClient } from '@/lib/ablyClient';

export const useRoomsPresence = (roomIds: string[]) => {
  const [roomCounts, setRoomCounts] = useState<Record<string, number>>({});
  
  useEffect(() => {
    let isMounted = true;
    const client = getAblyClient();
    if (!client) return;
    
    // To store channels so we can detach on unmount
    const channels: Ably.RealtimeChannel[] = [];
    
    const fetchPresence = async () => {
      for (const roomId of roomIds) {
        const channel = client.channels.get(`chess-game-${roomId}`);
        channels.push(channel);
        
        const updateCount = async () => {
          try {
            const members = await channel.presence.get() as Ably.PresenceMessage[];
            // Filter out spectators, only count active players
            const activePlayers = members.filter(m => m.data?.color !== 'spectator').length;
            if (isMounted) {
              setRoomCounts(prev => ({ ...prev, [roomId]: activePlayers }));
            }
          } catch (e) {
            console.error('Failed to get presence for room', roomId, e);
          }
        };
        
        await updateCount();
        
        // Subscribe to presence events to keep it live
        channel.presence.subscribe(['enter', 'leave', 'update'], updateCount).catch((e: unknown) => {
          console.error('Failed to subscribe to presence for room', roomId, e);
        });
      }
    };
    
    fetchPresence();
    
    return () => {
      isMounted = false;
      channels.forEach(ch => {
        ch.presence.unsubscribe();
        // We do not call ch.detach() here because if the user navigates to the game page,
        // it uses the exact same channel instance and detaching it would race with attaching it.
      });
    };
  }, [JSON.stringify(roomIds)]);
  
  return roomCounts;
};
