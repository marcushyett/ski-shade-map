'use client';

interface LoadingSpinnerProps {
  size?: number;
}

export default function LoadingSpinner({ size = 32 }: LoadingSpinnerProps) {
  return (
    <div className="loading-spinner" style={{ width: size, height: size }}>
      <svg 
        width={size} 
        height={size} 
        viewBox="0 0 32 32" 
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Sharp-edged gradient that cycles light to dark */}
          <linearGradient id="loading-sweep" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f0f0f0"/>
            <stop offset="50%" stopColor="#f0f0f0"/>
            <stop offset="50%" stopColor="#404040"/>
            <stop offset="100%" stopColor="#404040"/>
            <animate 
              attributeName="x1" 
              values="0%;-100%;0%"
              dur="2.5s" 
              repeatCount="indefinite"
            />
            <animate 
              attributeName="x2" 
              values="100%;0%;100%"
              dur="2.5s" 
              repeatCount="indefinite"
            />
          </linearGradient>
        </defs>
        <polygon points="16,4 28,28 4,28" fill="url(#loading-sweep)"/>
      </svg>
    </div>
  );
}
