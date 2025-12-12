'use client';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
}

export default function Logo({ size = 'md' }: LogoProps) {
  const sizes = {
    sm: { fontSize: 11, iconSize: 14, gap: 4 },
    md: { fontSize: 13, iconSize: 18, gap: 6 },
    lg: { fontSize: 16, iconSize: 24, gap: 8 },
  };

  const { fontSize, iconSize, gap } = sizes[size];

  return (
    <div className="flex items-center" style={{ gap }}>
      {/* Favicon as logo */}
      <svg 
        width={iconSize} 
        height={iconSize} 
        viewBox="0 0 32 32" 
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="logo-shade" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f5f5f5"/>
            <stop offset="50%" stopColor="#f5f5f5"/>
            <stop offset="50%" stopColor="#2a2a2a"/>
            <stop offset="100%" stopColor="#2a2a2a"/>
          </linearGradient>
        </defs>
        <polygon points="16,4.2 27.8,28 4.2,28" fill="url(#logo-shade)"/>
        <polygon points="16,4.2 19.4,11.3 12.6,11.3" fill="#ffffff" stroke="#e0e0e0" strokeWidth="0.5"/>
      </svg>
      
      {/* SKISHADE text */}
      <div className="flex" style={{ fontSize, fontWeight: 600, letterSpacing: '-0.02em' }}>
        <span 
          style={{ 
            backgroundColor: '#ffffff', 
            color: '#0a0a0a', 
            padding: '1px 3px',
            borderRadius: 1,
          }}
        >
          SKI
        </span>
        <span 
          style={{ 
            backgroundColor: '#0a0a0a', 
            color: '#ffffff', 
            padding: '1px 3px',
            borderRadius: 1,
          }}
        >
          SHADE
        </span>
      </div>
    </div>
  );
}

