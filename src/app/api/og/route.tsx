import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  
  const areaName = searchParams.get('name') || searchParams.get('area') || 'Ski Area';
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
            justifyContent: 'space-between',
            padding: '16px 32px',
            backgroundColor: '#000000',
            borderBottom: '1px solid #222',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {/* Brand text */}
            <div
              style={{
                backgroundColor: '#ffffff',
                color: '#0a0a0a',
                padding: '6px 12px',
                fontSize: 24,
                fontWeight: 'bold',
              }}
            >
              SKI
            </div>
            <div
              style={{
                backgroundColor: '#0a0a0a',
                color: '#ffffff',
                border: '1px solid #444',
                padding: '6px 12px',
                fontSize: 24,
                fontWeight: 'bold',
              }}
            >
              SHADE
            </div>
          </div>
          
          {timeDisplay && (
            <div style={{ fontSize: 20, color: '#888' }}>
              {timeDisplay}
            </div>
          )}
        </div>

        {/* Main content - Map-like visualization */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            background: 'linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%)',
          }}
        >
          {/* Topographic-style contour lines */}
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 1200 500"
            style={{ position: 'absolute', top: 0, left: 0 }}
          >
            {/* Contour lines */}
            <path d="M0,400 Q300,350 600,380 T1200,360" fill="none" stroke="#252525" strokeWidth="1" />
            <path d="M0,350 Q300,300 600,330 T1200,310" fill="none" stroke="#252525" strokeWidth="1" />
            <path d="M0,300 Q300,250 600,280 T1200,260" fill="none" stroke="#252525" strokeWidth="1" />
            <path d="M0,250 Q300,200 600,230 T1200,210" fill="none" stroke="#252525" strokeWidth="1" />
            <path d="M0,200 Q300,150 600,180 T1200,160" fill="none" stroke="#252525" strokeWidth="1" />
            <path d="M0,150 Q300,100 600,130 T1200,110" fill="none" stroke="#252525" strokeWidth="1" />
            
            {/* Ski runs - alternating sunny (white) and shaded (dark) */}
            <line x1="200" y1="80" x2="150" y2="450" stroke="#ffffff" strokeWidth="16" strokeLinecap="round" opacity="0.9" />
            <line x1="350" y1="100" x2="400" y2="480" stroke="#1a1a1a" strokeWidth="16" strokeLinecap="round" opacity="0.9" />
            <line x1="500" y1="60" x2="480" y2="460" stroke="#ffffff" strokeWidth="16" strokeLinecap="round" opacity="0.9" />
            <line x1="650" y1="90" x2="700" y2="490" stroke="#1a1a1a" strokeWidth="16" strokeLinecap="round" opacity="0.9" />
            <line x1="800" y1="70" x2="780" y2="450" stroke="#ffffff" strokeWidth="16" strokeLinecap="round" opacity="0.9" />
            <line x1="950" y1="110" x2="1000" y2="470" stroke="#1a1a1a" strokeWidth="16" strokeLinecap="round" opacity="0.9" />
            <line x1="1100" y1="80" x2="1080" y2="440" stroke="#ffffff" strokeWidth="16" strokeLinecap="round" opacity="0.9" />
            
            {/* Lifts (dashed lines) */}
            <line x1="280" y1="420" x2="320" y2="120" stroke="#666" strokeWidth="3" strokeDasharray="8,4" />
            <line x1="580" y1="440" x2="620" y2="100" stroke="#666" strokeWidth="3" strokeDasharray="8,4" />
            <line x1="880" y1="430" x2="920" y2="110" stroke="#666" strokeWidth="3" strokeDasharray="8,4" />
          </svg>

          {/* Sun indicator */}
          <div
            style={{
              position: 'absolute',
              top: 40,
              right: 60,
              width: 60,
              height: 60,
              borderRadius: '50%',
              backgroundColor: '#ffffff',
              boxShadow: '0 0 40px rgba(255,255,255,0.4)',
            }}
          />

          {/* Area name overlay */}
          <div
            style={{
              position: 'absolute',
              bottom: 80,
              left: 0,
              right: 0,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                fontSize: 48,
                fontWeight: 'bold',
                color: '#ffffff',
                textShadow: '0 2px 20px rgba(0,0,0,0.9)',
                padding: '12px 32px',
                background: 'rgba(0,0,0,0.6)',
                borderRadius: 4,
              }}
            >
              {areaName}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '12px 32px',
            backgroundColor: '#000000',
            borderTop: '1px solid #222',
          }}
        >
          <div style={{ fontSize: 16, color: '#666' }}>
            See where the sun will be on the slopes
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
