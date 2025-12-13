'use client';

import { memo, useState } from 'react';
import { Typography, Tooltip } from 'antd';
import { DownOutlined, RightOutlined, CheckCircleOutlined, CloseCircleOutlined, MinusCircleOutlined } from '@ant-design/icons';
import type { ResortSnowSummary } from '@/lib/snow-quality';
import { getConditionInfo } from '@/lib/snow-quality';
import { ConditionIcon } from '@/components/SnowQualityBadge';

const { Text } = Typography;

interface SnowConditionsPanelProps {
  summary: ResortSnowSummary | null;
  isLoading?: boolean;
}

// Score component factors for display
const SCORE_COMPONENTS = [
  { 
    name: 'Fresh Snow', 
    description: 'Snow in last 1-7 days',
    impact: '+10 to +30',
    details: 'More recent and heavier snowfall = higher bonus'
  },
  { 
    name: 'Temperature', 
    description: 'Current temp effect',
    impact: '-20 to +5',
    details: 'Cold preserves snow, warm causes melting'
  },
  { 
    name: 'Altitude', 
    description: 'Elevation impact',
    impact: '-10 to +10',
    details: 'Higher altitude = better snow preservation'
  },
  { 
    name: 'Time of Day', 
    description: 'Afternoon degradation',
    impact: '-10 to 0',
    details: 'Conditions typically worse after 3pm'
  },
  { 
    name: 'Sun Exposure', 
    description: 'Slope aspect vs sun',
    impact: '-10 to +5',
    details: 'South-facing warms faster, north-facing stays cooler'
  },
  { 
    name: 'Wind', 
    description: 'Wind speed effect',
    impact: '-10 to 0',
    details: 'High winds create hardpack and scoured conditions'
  },
  { 
    name: 'Steepness', 
    description: 'Mogul formation',
    impact: '-5 to 0',
    details: 'Steep runs develop moguls through the day'
  },
];

function SnowConditionsPanelInner({ summary, isLoading }: SnowConditionsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  
  if (isLoading || !summary) {
    return null;
  }
  
  const mainCondition = getConditionInfo(summary.overallCondition);
  // Color based on percentage: green (70%+), neutral gray (40-70%), red (<40%)
  const scoreColor = summary.overallScore >= 70 ? '#22c55e' : summary.overallScore >= 40 ? '#a3a3a3' : '#ef4444';
  
  return (
    <div className="snow-conditions-panel">
      {/* Header - always visible */}
      <div 
        className="flex items-center gap-2 py-1 cursor-pointer hover:bg-white/5 rounded"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <DownOutlined style={{ fontSize: 8 }} /> : <RightOutlined style={{ fontSize: 8 }} />}
        <Text type="secondary" style={{ fontSize: 9 }}>SNOW</Text>
        <ConditionIcon iconType={mainCondition.iconType} style={{ fontSize: 12, color: mainCondition.color }} />
        <span style={{ fontSize: 11, color: scoreColor, fontWeight: 600 }}>
          {Math.round(summary.overallScore)}%
        </span>
        <span style={{ fontSize: 10, color: '#888' }}>
          {mainCondition.label}
        </span>
      </div>
      
      {/* Expanded content */}
      {expanded && (
        <div className="ml-3 mt-1 p-2 rounded" style={{ background: 'rgba(255,255,255,0.02)', fontSize: 10 }}>
          {/* Description */}
          <div style={{ color: '#ccc', marginBottom: 8 }}>
            {summary.description}
          </div>
          
          {/* Last snowfall */}
          {summary.lastSnowfall && (
            <div className="flex justify-between mb-2 pb-2 border-b border-white/10">
              <Text type="secondary" style={{ fontSize: 9 }}>Last snowfall</Text>
              <Text style={{ fontSize: 9, color: '#4ade80' }}>
                {summary.lastSnowfall.amount}cm on {new Date(summary.lastSnowfall.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </Text>
            </div>
          )}
          
          {/* Condition breakdown */}
          <div className="mb-2">
            <Text type="secondary" style={{ fontSize: 9, display: 'block', marginBottom: 4 }}>
              Current conditions
            </Text>
            <div className="flex flex-wrap gap-1">
              {summary.conditionBreakdown.slice(0, 4).map((item) => {
                const info = getConditionInfo(item.condition);
                return (
                  <Tooltip key={item.condition} title={info.label}>
                    <span 
                      style={{ 
                        fontSize: 9, 
                        padding: '2px 4px',
                        background: `${info.color}20`,
                        borderRadius: 3,
                        color: info.color,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 2,
                      }}
                    >
                      <ConditionIcon iconType={info.iconType} style={{ fontSize: 9 }} />
                      {item.percentage}%
                    </span>
                  </Tooltip>
                );
              })}
            </div>
          </div>
          
          {/* Score Components */}
          <div className="mt-2 pt-2 border-t border-white/10">
            <Text type="secondary" style={{ fontSize: 9, display: 'block', marginBottom: 4 }}>
              Score factors (base: 50%)
            </Text>
            <div style={{ display: 'grid', gap: 2 }}>
              {SCORE_COMPONENTS.map((component) => (
                <Tooltip 
                  key={component.name} 
                  title={
                    <div style={{ fontSize: 11 }}>
                      <strong>{component.name}</strong>
                      <div style={{ marginTop: 2 }}>{component.details}</div>
                      <div style={{ marginTop: 4, color: '#888' }}>Impact: {component.impact}</div>
                    </div>
                  }
                >
                  <div 
                    className="flex items-center justify-between"
                    style={{ 
                      fontSize: 8, 
                      color: '#888',
                      padding: '1px 0',
                      cursor: 'help',
                    }}
                  >
                    <span>{component.name}</span>
                    <span style={{ 
                      color: component.impact.startsWith('+') ? '#22c55e' 
                        : component.impact.startsWith('-') ? '#ef4444' 
                        : '#888',
                      fontFamily: 'monospace',
                      fontSize: 7,
                    }}>
                      {component.impact}
                    </span>
                  </div>
                </Tooltip>
              ))}
            </div>
            <div style={{ fontSize: 7, color: '#555', marginTop: 4, textAlign: 'center' }}>
              Hover for details • Final score clamped 0-100%
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const SnowConditionsPanel = memo(SnowConditionsPanelInner);
export default SnowConditionsPanel;
