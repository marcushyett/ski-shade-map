'use client';

import { memo } from 'react';
import { Tooltip } from 'antd';
import {
  CheckCircleOutlined,
  CompressOutlined,
  DashOutlined,
  SunOutlined,
  SwapOutlined,
  CloudOutlined,
  BorderOutlined,
  BarChartOutlined,
  StopOutlined,
  FallOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { SnowQuality, SnowCondition, SnowIconType } from '@/lib/snow-quality';
import { getConditionInfo } from '@/lib/snow-quality';

// Snowflake icon (not in antd, so we create a simple one)
function SnowflakeIcon({ style }: { style?: React.CSSProperties }) {
  return (
    <span role="img" aria-label="snowflake" style={style}>
      <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
        <path d="M12 2v4m0 12v4M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83M12 8a4 4 0 100 8 4 4 0 000-8z" 
              stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
      </svg>
    </span>
  );
}

// Map icon types to Ant Design icons
function ConditionIcon({ iconType, style }: { iconType: SnowIconType; style?: React.CSSProperties }) {
  const iconMap: Record<SnowIconType, React.ReactNode> = {
    'snowflake': <SnowflakeIcon style={style} />,
    'check-circle': <CheckCircleOutlined style={style} />,
    'compress': <CompressOutlined style={style} />,
    'dash': <DashOutlined style={style} />,
    'sun': <SunOutlined style={style} />,
    'swap': <SwapOutlined style={style} />,
    'cloud': <CloudOutlined style={style} />,
    'border': <BorderOutlined style={style} />,
    'bar-chart': <BarChartOutlined style={style} />,
    'stop': <StopOutlined style={style} />,
    'fall': <FallOutlined style={style} />,
    'warning': <WarningOutlined style={style} />,
  };
  
  return <>{iconMap[iconType]}</>;
}

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
  
  // Color based on percentage: green (70%+), neutral gray (40-70%), red (<40%)
  const scoreColor = quality.score >= 70 ? '#22c55e' : quality.score >= 40 ? '#a3a3a3' : '#ef4444';
  
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
        <ConditionIcon iconType={info.iconType} style={{ fontSize: style.iconSize, color: info.color }} />
        {showScore && (
          <span style={{ color: scoreColor, fontWeight: 600 }}>
            {Math.round(quality.score)}%
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
  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#a3a3a3' : '#ef4444';
  
  return (
    <span style={{ 
      display: 'inline-flex', 
      alignItems: 'center', 
      gap: 2,
      fontSize: 9,
    }}>
      <ConditionIcon iconType={info.iconType} style={{ fontSize: 10, color: info.color }} />
      <span style={{ color }}>{Math.round(score)}%</span>
    </span>
  );
}

// Export ConditionIcon for use in other components
export { ConditionIcon };
