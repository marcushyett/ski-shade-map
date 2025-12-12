'use client';

import { Typography, Divider } from 'antd';

const { Text } = Typography;

export default function Legend() {
  const difficulties = [
    { name: 'Novice', color: '#4CAF50' },
    { name: 'Easy', color: '#2196F3' },
    { name: 'Intermediate', color: '#F44336' },
    { name: 'Advanced', color: '#212121' },
  ];

  return (
    <div className="legend">
      <Text strong style={{ fontSize: 10 }}>LEGEND</Text>
      
      <Divider />
      
      <div className="flex flex-col gap-1">
        {difficulties.map(d => (
          <div key={d.name} className="flex items-center gap-1.5">
            <div 
              className="w-3 h-0.5"
              style={{ backgroundColor: d.color, borderRadius: 1 }}
            />
            <Text style={{ fontSize: 10 }}>{d.name}</Text>
          </div>
        ))}
      </div>

      <Divider />

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <div 
            className="w-4 h-2"
            style={{ 
              backgroundColor: '#FFD700',
              borderRadius: 1,
            }}
          />
          <Text style={{ fontSize: 10 }}>Sun</Text>
        </div>
        <div className="flex items-center gap-1.5">
          <div 
            className="w-4 h-2"
            style={{ 
              backgroundColor: '#1a237e',
              borderRadius: 1,
            }}
          />
          <Text style={{ fontSize: 10 }}>Shade</Text>
        </div>
      </div>

      <Divider />

      <div className="flex items-center gap-1.5">
        <div 
          className="w-3 h-px"
          style={{ 
            background: 'repeating-linear-gradient(90deg, #666, #666 2px, transparent 2px, transparent 3px)'
          }}
        />
        <Text style={{ fontSize: 10 }}>Lift</Text>
      </div>
    </div>
  );
}
