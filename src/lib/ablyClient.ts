import { Realtime } from 'ably';

let globalAblyClient: Realtime | null = null;

export const getAblyClient = () => {
  if (typeof window === 'undefined') return null as any;

  if (!globalAblyClient) {
    let myClientId: string | null = localStorage.getItem('chess-user-id');
    if (!myClientId) {
      myClientId = 'user-' + Math.random().toString(36).substring(2, 11);
      localStorage.setItem('chess-user-id', myClientId);
    }
    
    globalAblyClient = new Realtime({
      authUrl: `/api/ably/auth?clientId=${myClientId}`,
      clientId: myClientId || undefined
    });
  }
  return globalAblyClient;
};
