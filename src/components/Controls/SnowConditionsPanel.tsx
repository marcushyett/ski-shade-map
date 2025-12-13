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
        <span style={{ fontSize: 11, color: mainCondition.color, fontWeight: 600 }}>
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
                  Conditions determined by:
                </div>
                <div style={{ display: 'grid', gap: 2, fontSize: 7 }}>
                  <div>• Recent snowfall → Powder or Fresh Groomed</div>
                  <div>• Cold temps ({`<`}0°C) → Packed or Hard Pack</div>
                  <div>• Warm temps (0-5°C) → Soft</div>
                  <div>• Hot temps ({`>`}5°C) → Slush</div>
                  <div>• Steep slopes + afternoon → Moguls</div>
                  <div>• High winds → Wind-affected</div>
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
    'spring-corn': 'Soft, warming snow (0-5°C) - still enjoyable, best earlier in the day',
    'soft': 'Soft, warming snow (0-5°C) - still enjoyable, best earlier in the day',
    'variable': 'Mixed conditions - expect changes across the run',
    'wind-affected': 'Wind-packed or scoured areas - uneven surface',
    'crusty': 'Frozen crust on surface - can break through unexpectedly',
    'moguls': 'Bumps forming on steep terrain - develops through the day',
    'icy': 'Hard, slippery surface - sharp edges and caution needed',
    'slush': 'Wet, heavy, waterlogged snow (>5°C) - tiring and slow',
    'poor': 'Challenging conditions - consider other activities',
  };
  return descriptions[condition] || condition;
}

const SnowConditionsPanel = memo(SnowConditionsPanelInner);
export default SnowConditionsPanel;
