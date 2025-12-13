'use client';

import { memo } from 'react';
import { Tooltip } from 'antd';
import type { SnowQuality, SnowCondition } from '@/lib/snow-quality';
import { getConditionInfo } from '@/lib/snow-quality';

interface SnowQualityBadgeProps {
  quality: SnowQuality;
  size?: 'small' | 'medium' | 'large';
  showLabel?: boolean;
  showScore?: boolean;
}

function SnowQualityBadgeInner({ 
  quality, 
  size = 'medium', 
  showLabel = false,
  showScore = true,
}: SnowQualityBadgeProps) {
  const info = getConditionInfo(quality.condition);
  
  const sizeStyles = {
    small: { fontSize: 10, padding: '1px 4px', iconSize: 10 },
    medium: { fontSize: 11, padding: '2px 6px', iconSize: 12 },
    large: { fontSize: 13, padding: '4px 8px', iconSize: 16 },
  };
  
  const style = sizeStyles[size];
  
  const scoreColor = quality.score >= 7 ? '#22c55e' : quality.score >= 5 ? '#eab308' : '#ef4444';
  
  return (
    <Tooltip
      title={
        <div style={{ fontSize: 11 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{info.label} Conditions</div>
          <div style={{ opacity: 0.9 }}>{quality.description}</div>
          {quality.factors.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 10 }}>
              {quality.factors.slice(0, 3).map((f, i) => (
                <div key={i} style={{ 
                  opacity: 0.8,
                  color: f.impact === 'positive' ? '#4ade80' : f.impact === 'negative' ? '#f87171' : '#ccc'
                }}>
                  {f.impact === 'positive' ? '+' : f.impact === 'negative' ? '−' : '•'} {f.description}
                </div>
              ))}
            </div>
          )}
        </div>
      }
      placement="top"
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: style.padding,
          background: 'rgba(0, 0, 0, 0.6)',
          borderRadius: 4,
          fontSize: style.fontSize,
          cursor: 'help',
          border: `1px solid ${info.color}40`,
        }}
      >
        <span style={{ fontSize: style.iconSize }}>{quality.icon}</span>
        {showScore && (
          <span style={{ color: scoreColor, fontWeight: 600 }}>
            {quality.score.toFixed(1)}
          </span>
        )}
        {showLabel && (
          <span style={{ color: '#ccc' }}>{info.label}</span>
        )}
      </span>
    </Tooltip>
  );
}

const SnowQualityBadge = memo(SnowQualityBadgeInner);
export default SnowQualityBadge;

// Simple score display for map labels
export function SnowScoreIndicator({ score, condition }: { score: number; condition: SnowCondition }) {
  const info = getConditionInfo(condition);
  const color = score >= 7 ? '#22c55e' : score >= 5 ? '#eab308' : '#ef4444';
  
  return (
    <span style={{ 
      display: 'inline-flex', 
      alignItems: 'center', 
      gap: 2,
      fontSize: 9,
    }}>
      <span>{info.icon}</span>
      <span style={{ color }}>{score.toFixed(0)}</span>
    </span>
  );
}

