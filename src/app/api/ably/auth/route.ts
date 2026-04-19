import { NextResponse } from 'next/server';
import * as Ably from 'ably';

export async function GET(request: Request) {
  const apiKey = process.env.ABLY_API_KEY;
  const { searchParams } = new URL(request.url);
  const requestedClientId = searchParams.get('clientId');
  
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ABLY_API_KEY is not set in environment variables.' },
      { status: 500 }
    );
  }

  try {
    const client = new Ably.Rest(apiKey);
    const tokenRequestData = await client.auth.createTokenRequest({
      clientId: requestedClientId || ('chess-player-' + Math.random().toString(36).substring(2, 9)),
    });
    
    return NextResponse.json(tokenRequestData);
  } catch (error) {
    console.error('Ably Token Request Error:', error);
    return NextResponse.json(
      { error: 'Failed to create token request' },
      { status: 500 }
    );
  }
}
