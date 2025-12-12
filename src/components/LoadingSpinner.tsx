'use client';

import { useId } from 'react';

interface LoadingSpinnerProps {
  size?: number;
}

export default function LoadingSpinner({ size = 32 }: LoadingSpinnerProps) {
  const clipId = useId();
  
  return (
    <div className="loading-spinner" style={{ width: size, height: size }}>
      <svg 
        width={size} 
        height={size} 
        viewBox="0 0 32 32" 
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Clip path for the mountain shape */}
          <clipPath id={clipId}>
            <polygon points="16,4 28,28 4,28" />
          </clipPath>
        </defs>
        
        {/* Dark background of mountain */}
        <polygon points="16,4 28,28 4,28" fill="#404040" />
        
        {/* Light sweep that moves across - solid color with hard edge */}
        <rect 
          x="-24" 
          y="0" 
          width="24" 
          height="32" 
          fill="#f0f0f0"
          clipPath={`url(#${clipId})`}
        >
          <animate 
            attributeName="x" 
            values="-24;32;-24"
            dur="2s" 
            repeatCount="indefinite"
            calcMode="linear"
          />
        </rect>
      </svg>
    </div>
  );
}
