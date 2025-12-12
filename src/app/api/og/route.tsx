import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  
  const areaName = searchParams.get('area') || 'Ski Area';
  const time = searchParams.get('t');
  
  // Format time if provided
  let timeDisplay = '';
  if (time) {
    const minutes = parseInt(time, 10);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    timeDisplay = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#0a0a0a',
          fontFamily: 'monospace',
        }}
      >
        {/* Header bar with logo */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '20px 40px',
            backgroundColor: '#000000',
          }}
        >
          {/* Mountain logo */}
          <svg width="40" height="40" viewBox="0 0 40 40">
            <defs>
              <linearGradient id="shade" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f0f0f0" />
                <stop offset="61.8%" stopColor="#f0f0f0" />
                <stop offset="61.8%" stopColor="#404040" />
                <stop offset="100%" stopColor="#404040" />
              </linearGradient>
            </defs>
            <polygon points="20,5 35,35 5,35" fill="url(#shade)" />
          </svg>
          
          {/* Brand text */}
          <div style={{ display: 'flex', marginLeft: 16 }}>
            <div
              style={{
                backgroundColor: '#ffffff',
                color: '#0a0a0a',
                padding: '4px 8px',
                fontSize: 20,
                fontWeight: 'bold',
              }}
            >
              SKI
            </div>
            <div
              style={{
                backgroundColor: '#0a0a0a',
                color: '#ffffff',
                border: '1px solid #333',
                padding: '4px 8px',
                fontSize: 20,
                fontWeight: 'bold',
              }}
            >
              SHADE
            </div>
          </div>
        </div>

        {/* Main content */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px',
            position: 'relative',
          }}
        >
          {/* Background mountains */}
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 1200 400"
            style={{ position: 'absolute', bottom: 0, left: 0 }}
          >
            <path
              d="M0,250 L200,150 L350,220 L500,100 L650,180 L800,80 L950,160 L1100,120 L1200,180 L1200,400 L0,400 Z"
              fill="#1a1a1a"
            />
            <path
              d="M0,300 L150,250 L300,280 L450,200 L600,260 L750,190 L900,240 L1050,210 L1200,250 L1200,400 L0,400 Z"
              fill="#252525"
            />
            
            {/* Ski runs with sun/shade */}
            <line x1="400" y1="150" x2="350" y2="350" stroke="#ffffff" strokeWidth="12" opacity="0.8" />
            <line x1="550" y1="120" x2="600" y2="380" stroke="#1a1a1a" strokeWidth="12" opacity="0.8" />
            <line x1="700" y1="160" x2="680" y2="400" stroke="#ffffff" strokeWidth="12" opacity="0.8" />
            <line x1="850" y1="100" x2="900" y2="420" stroke="#1a1a1a" strokeWidth="12" opacity="0.8" />
          </svg>

          {/* Sun */}
          <div
            style={{
              position: 'absolute',
              top: 60,
              right: 80,
              width: 80,
              height: 80,
              borderRadius: '50%',
              backgroundColor: '#ffffff',
              boxShadow: '0 0 60px rgba(255,255,255,0.5)',
            }}
          />

          {/* Area name */}
          <div
            style={{
              fontSize: 48,
              fontWeight: 'bold',
              color: '#ffffff',
              textAlign: 'center',
              zIndex: 10,
              textShadow: '0 2px 20px rgba(0,0,0,0.8)',
            }}
          >
            {areaName}
          </div>

          {timeDisplay && (
            <div
              style={{
                fontSize: 24,
                color: '#888888',
                marginTop: 16,
                zIndex: 10,
              }}
            >
              Sun position at {timeDisplay}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '20px 40px',
            backgroundColor: '#000000',
          }}
        >
          <div style={{ fontSize: 18, color: '#666666' }}>
            See where the sun will be on the slopes ☀️🎿
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}

