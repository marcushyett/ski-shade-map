'use client';

import { useId } from 'react';

interface LoadingSpinnerProps {
  size?: number;
}

export default function LoadingSpinner({ size = 32 }: LoadingSpinnerProps) {
  const gradientId = useId();
  
  return (
    <div className="loading-spinner" style={{ width: size, height: size }}>
      <svg 
        width={size} 
        height={size} 
        viewBox="0 0 32 32" 
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Cycling gradient - dark to light, moving right to left */}
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#404040">
              <animate 
                attributeName="stop-color" 
                values="#404040;#f0f0f0;#404040"
                dur="2s" 
                repeatCount="indefinite"
              />
            </stop>
            <stop offset="50%" stopColor="#f0f0f0">
              <animate 
                attributeName="stop-color" 
                values="#f0f0f0;#404040;#f0f0f0"
                dur="2s" 
                repeatCount="indefinite"
              />
            </stop>
            <stop offset="100%" stopColor="#404040">
              <animate 
                attributeName="stop-color" 
                values="#404040;#f0f0f0;#404040"
                dur="2s" 
                repeatCount="indefinite"
              />
            </stop>
            {/* Move gradient from right to left */}
            <animate 
              attributeName="x1" 
              values="100%;-100%"
              dur="2s" 
              repeatCount="indefinite"
            />
            <animate 
              attributeName="x2" 
              values="200%;0%"
              dur="2s" 
              repeatCount="indefinite"
            />
          </linearGradient>
        </defs>
        <polygon points="16,4 28,28 4,28" fill={`url(#${gradientId})`}/>
      </svg>
    </div>
  );
}
