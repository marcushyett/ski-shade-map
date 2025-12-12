import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  
  const areaName = searchParams.get('name') || 'Ski Area';
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
            Find sunny or shaded ski slopes throughout the day
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
