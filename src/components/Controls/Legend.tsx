'use client';

import { Typography, Space, Divider } from 'antd';

const { Text, Title } = Typography;

export default function Legend() {
  const difficulties = [
    { name: 'Novice', color: '#4CAF50' },
    { name: 'Easy', color: '#2196F3' },
    { name: 'Intermediate', color: '#F44336' },
    { name: 'Advanced/Expert', color: '#212121' },
  ];

  return (
    <div className="legend p-3 bg-white rounded-lg shadow-sm">
      <Title level={5} className="mb-2 mt-0">Legend</Title>
      
      <div className="mb-2">
        <Text type="secondary" className="text-xs">Run Difficulty</Text>
        <Space direction="vertical" size={2} className="mt-1">
          {difficulties.map(d => (
            <div key={d.name} className="flex items-center gap-2">
              <div 
                className="w-4 h-1 rounded"
                style={{ backgroundColor: d.color }}
              />
              <Text className="text-xs">{d.name}</Text>
            </div>
          ))}
        </Space>
      </div>

      <Divider className="my-2" />

      <div>
        <Text type="secondary" className="text-xs">Sun Exposure</Text>
        <Space direction="vertical" size={4} className="mt-1">
          <div className="flex items-center gap-2">
            <div 
              className="w-6 h-3 rounded"
              style={{ 
                backgroundColor: '#FFD700',
                boxShadow: '0 0 4px rgba(255, 215, 0, 0.6)',
              }}
            />
            <Text className="text-xs font-medium">☀️ Sunny</Text>
          </div>
          <div className="flex items-center gap-2">
            <div 
              className="w-6 h-3 rounded"
              style={{ 
                backgroundColor: '#1a237e',
                boxShadow: '0 0 4px rgba(26, 35, 126, 0.4)',
              }}
            />
            <Text className="text-xs font-medium">🌑 Shaded</Text>
          </div>
        </Space>
      </div>

      <Divider className="my-2" />

      <div>
        <Text type="secondary" className="text-xs">Lifts</Text>
        <div className="flex items-center gap-2 mt-1">
          <div 
            className="w-4 h-0.5"
            style={{ 
              backgroundColor: '#000',
              backgroundImage: 'repeating-linear-gradient(90deg, #000, #000 4px, transparent 4px, transparent 6px)'
            }}
          />
          <Text className="text-xs">Lift</Text>
        </div>
      </div>
    </div>
  );
}
