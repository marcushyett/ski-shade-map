'use client';

import { useState, useEffect, useCallback } from 'react';
import { Select, Input, Space, Tag, Typography } from 'antd';
import { SearchOutlined, EnvironmentOutlined } from '@ant-design/icons';
import type { SkiAreaSummary } from '@/lib/types';
import debounce from 'lodash.debounce';

const { Text } = Typography;

interface SkiAreaPickerProps {
  onSelect: (skiArea: SkiAreaSummary) => void;
  selectedArea: SkiAreaSummary | null;
}

interface Country {
  country: string;
  count: number;
}

export default function SkiAreaPicker({ onSelect, selectedArea }: SkiAreaPickerProps) {
  const [countries, setCountries] = useState<Country[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [skiAreas, setSkiAreas] = useState<SkiAreaSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');

  // Fetch countries on mount
  useEffect(() => {
    fetch('/api/ski-areas/countries')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setCountries(data);
          // Default to France
          const france = data.find((c: Country) => 
            c.country?.toLowerCase() === 'france' || c.country === 'FR'
          );
          if (france) {
            setSelectedCountry(france.country);
          }
        }
      })
      .catch(console.error);
  }, []);

  // Fetch ski areas when country changes or search
  const fetchSkiAreas = useCallback(async (country: string | null, search: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (country) params.set('country', country);
      if (search) params.set('search', search);
      params.set('limit', '100');

      const res = await fetch(`/api/ski-areas?${params}`);
      const data = await res.json();
      setSkiAreas(data.areas || []);
    } catch (error) {
      console.error('Failed to fetch ski areas:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkiAreas(selectedCountry, searchText);
  }, [selectedCountry, fetchSkiAreas]);

  const debouncedSearch = useCallback(
    debounce((value: string) => {
      fetchSkiAreas(selectedCountry, value);
    }, 300),
    [selectedCountry, fetchSkiAreas]
  );

  const handleSearch = (value: string) => {
    setSearchText(value);
    debouncedSearch(value);
  };

  return (
    <div className="ski-area-picker">
      <Space direction="vertical" size="small" className="w-full">
        <Select
          placeholder="Select Country"
          value={selectedCountry}
          onChange={setSelectedCountry}
          className="w-full"
          showSearch
          optionFilterProp="children"
          allowClear
        >
          {countries.map(c => (
            <Select.Option key={c.country} value={c.country}>
              {c.country} ({c.count})
            </Select.Option>
          ))}
        </Select>

        <Select
          placeholder="Search ski areas..."
          value={selectedArea?.id}
          onChange={(id) => {
            const area = skiAreas.find(a => a.id === id);
            if (area) onSelect(area);
          }}
          className="w-full"
          showSearch
          loading={loading}
          filterOption={false}
          onSearch={handleSearch}
          notFoundContent={loading ? 'Loading...' : 'No ski areas found'}
          suffixIcon={<SearchOutlined />}
        >
          {skiAreas.map(area => (
            <Select.Option key={area.id} value={area.id}>
              <Space>
                <EnvironmentOutlined />
                <span>{area.name}</span>
                {area.region && (
                  <Tag color="blue" style={{ marginLeft: 8 }}>
                    {area.region}
                  </Tag>
                )}
              </Space>
            </Select.Option>
          ))}
        </Select>

        {selectedArea && (
          <div className="selected-area-info p-2 bg-gray-50 rounded">
            <Text strong>{selectedArea.name}</Text>
            {selectedArea.region && (
              <Text type="secondary" className="ml-2">
                {selectedArea.region}, {selectedArea.country}
              </Text>
            )}
          </div>
        )}
      </Space>
    </div>
  );
}

