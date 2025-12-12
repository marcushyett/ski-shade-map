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
            <stop offset="0%" stopColor="#f0f0f0"/>
            <stop offset="61.8%" stopColor="#f0f0f0"/>
            <stop offset="61.8%" stopColor="#404040"/>
            <stop offset="100%" stopColor="#404040"/>
          </linearGradient>
        </defs>
        <polygon points="16,4 28,28 4,28" fill="url(#logo-shade)"/>
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

