'use client';

import { memo, useState } from 'react';
import { Typography, Tooltip } from 'antd';
import { DownOutlined, RightOutlined, InfoCircleOutlined } from '@ant-design/icons';
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
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  
  if (isLoading || !summary) {
    return null;
  }
  
  const mainCondition = getConditionInfo(summary.overallCondition);
  // Color based on percentage: green (70%+), neutral gray (40-70%), red (<40%)
  const scoreColor = summary.overallScore >= 70 ? '#22c55e' : summary.overallScore >= 40 ? '#a3a3a3' : '#ef4444';
  const scoreDelta = Math.round(summary.overallScore - 50);
  
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
          {scoreDelta >= 0 ? '+' : ''}{scoreDelta}%
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
          
          {/* Snow types breakdown - main content */}
          <div className="mb-2">
            <Text type="secondary" style={{ fontSize: 9, display: 'block', marginBottom: 4 }}>
              Expected snow types
            </Text>
            <div style={{ display: 'grid', gap: 3 }}>
              {summary.conditionBreakdown.map((item) => {
                const info = getConditionInfo(item.condition);
                return (
                  <Tooltip 
                    key={item.condition} 
                    title={getConditionDescription(item.condition)}
                  >
                    <div 
                      className="flex items-center gap-2"
                      style={{ fontSize: 9, cursor: 'help' }}
                    >
                      <div style={{ width: 16, textAlign: 'center' }}>
                        <ConditionIcon iconType={info.iconType} style={{ fontSize: 10, color: info.color }} />
                      </div>
                      <span style={{ color: '#aaa', flex: 1 }}>{info.label}</span>
                      <div style={{ width: 60, height: 6, background: '#222', borderRadius: 2, overflow: 'hidden' }}>
                        <div 
                          style={{ 
                            width: `${item.percentage}%`, 
                            height: '100%', 
                            background: info.color,
                            borderRadius: 2,
                          }} 
                        />
                      </div>
                      <span style={{ color: info.color, fontWeight: 500, width: 28, textAlign: 'right' }}>
                        {item.percentage}%
                      </span>
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          </div>
          
          {/* How it works - hidden by default */}
          <div 
            className="mt-2 pt-2 border-t border-white/10"
            style={{ fontSize: 8, color: '#666' }}
          >
            <div 
              className="flex items-center gap-1 cursor-pointer hover:text-gray-400"
              onClick={(e) => { e.stopPropagation(); setShowHowItWorks(!showHowItWorks); }}
            >
              <InfoCircleOutlined style={{ fontSize: 9 }} />
              <span>{showHowItWorks ? 'Hide' : 'How is this calculated?'}</span>
            </div>
            
            {showHowItWorks && (
              <div style={{ marginTop: 6, color: '#888', lineHeight: 1.4 }}>
                <div style={{ marginBottom: 4 }}>
                  Score starts at 50% (baseline). Factors adjust it:
                </div>
                <div style={{ display: 'grid', gap: 2, fontSize: 7 }}>
                  <div>• <span style={{ color: '#4ade80' }}>Fresh snow</span>: up to +30%</div>
                  <div>• <span style={{ color: '#4ade80' }}>Cold temps / high altitude</span>: up to +15%</div>
                  <div>• <span style={{ color: '#ef4444' }}>Warm temps</span>: up to -20%</div>
                  <div>• <span style={{ color: '#ef4444' }}>Afternoon / sun exposure</span>: up to -15%</div>
                  <div>• <span style={{ color: '#ef4444' }}>High wind / steep slopes</span>: up to -15%</div>
                </div>
                <div style={{ marginTop: 4, color: '#555' }}>
                  Final score clamped 0-100%. See docs for full algorithm.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Get description for each condition type
function getConditionDescription(condition: string): string {
  const descriptions: Record<string, string> = {
    'powder': 'Fresh, light, untracked snow - the dream!',
    'fresh-groomed': 'Recently groomed corduroy - smooth and fast',
    'packed-powder': 'Well-consolidated snow - reliable skiing',
    'hard-pack': 'Firm, compacted snow - good edge grip needed',
    'spring-corn': 'Softening snow from warmth - can be nice in morning',
    'variable': 'Mixed conditions - expect changes',
    'wind-affected': 'Wind-packed or scoured areas',
    'crusty': 'Frozen crust on surface - can be tricky',
    'moguls': 'Bumps forming on steep terrain',
    'icy': 'Hard, slippery surface - caution advised',
    'slush': 'Wet, heavy snow - slower skiing',
    'poor': 'Challenging conditions overall',
  };
  return descriptions[condition] || condition;
}

const SnowConditionsPanel = memo(SnowConditionsPanelInner);
export default SnowConditionsPanel;
