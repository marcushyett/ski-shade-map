'use client';

import { memo, useState } from 'react';
import { Typography, Tooltip } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import type { ResortSnowSummary } from '@/lib/snow-quality';
import { getConditionInfo } from '@/lib/snow-quality';
import { ConditionIcon } from '@/components/SnowQualityBadge';

const { Text } = Typography;

interface SnowConditionsPanelProps {
  summary: ResortSnowSummary | null;
  isLoading?: boolean;
}

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
            <div className="flex justify-between mb-1">
              <Text type="secondary" style={{ fontSize: 9 }}>Last snow</Text>
              <Text style={{ fontSize: 9 }}>
                {summary.lastSnowfall.amount}cm on {new Date(summary.lastSnowfall.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </Text>
            </div>
          )}
          
          {/* Condition breakdown */}
          <div className="mt-2 mb-2">
            <Text type="secondary" style={{ fontSize: 9, display: 'block', marginBottom: 4 }}>
              Conditions breakdown
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
          
          {/* Recommendations */}
          {summary.recommendations.length > 0 && (
            <div className="mt-2 pt-2 border-t border-white/10">
              <Text type="secondary" style={{ fontSize: 9, display: 'block', marginBottom: 4 }}>
                Tips
              </Text>
              {summary.recommendations.slice(0, 2).map((rec, i) => (
                <div key={i} style={{ fontSize: 9, color: '#999', marginBottom: 2 }}>
                  • {rec}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SnowConditionsPanel = memo(SnowConditionsPanelInner);
export default SnowConditionsPanel;
