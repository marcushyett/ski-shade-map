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
          {/* Animated gradient that sweeps across */}
          <linearGradient id="loading-sweep" x1="-100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#404040"/>
            <stop offset="40%" stopColor="#404040"/>
            <stop offset="50%" stopColor="#f0f0f0"/>
            <stop offset="60%" stopColor="#404040"/>
            <stop offset="100%" stopColor="#404040"/>
            <animate 
              attributeName="x1" 
              from="-100%" 
              to="100%" 
              dur="1.5s" 
              repeatCount="indefinite"
            />
            <animate 
              attributeName="x2" 
              from="0%" 
              to="200%" 
              dur="1.5s" 
              repeatCount="indefinite"
            />
          </linearGradient>
        </defs>
        <polygon points="16,4 28,28 4,28" fill="url(#loading-sweep)"/>
      </svg>
    </div>
  );
}

