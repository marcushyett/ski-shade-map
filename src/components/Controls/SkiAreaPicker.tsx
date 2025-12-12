'use client';

import { useState, useEffect, useCallback } from 'react';
import { Select, Space, Tag } from 'antd';
import { SearchOutlined, EnvironmentOutlined } from '@ant-design/icons';
import type { SkiAreaSummary } from '@/lib/types';
import debounce from 'lodash.debounce';

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

  // Build options with the selected area included if not in list
  const options = skiAreas.map(area => ({
    value: area.id,
    label: area.name,
    area,
  }));

  // If selectedArea exists but isn't in the current list, add it
  if (selectedArea && !skiAreas.find(a => a.id === selectedArea.id)) {
    options.unshift({
      value: selectedArea.id,
      label: selectedArea.name,
      area: selectedArea,
    });
  }

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
            const option = options.find(o => o.value === id);
            if (option) onSelect(option.area);
          }}
          className="w-full"
          showSearch
          loading={loading}
          filterOption={false}
          onSearch={handleSearch}
          notFoundContent={loading ? 'Loading...' : 'No ski areas found'}
          suffixIcon={<SearchOutlined />}
          optionLabelProp="label"
        >
          {options.map(opt => (
            <Select.Option key={opt.value} value={opt.value} label={opt.label}>
              <Space>
                <EnvironmentOutlined style={{ opacity: 0.5 }} />
                <span style={{ color: '#e5e5e5' }}>{opt.label}</span>
                {opt.area.region && (
                  <Tag style={{ marginLeft: 4, fontSize: 10 }}>
                    {opt.area.region}
                  </Tag>
                )}
              </Space>
            </Select.Option>
          ))}
        </Select>
      </Space>
    </div>
  );
}
