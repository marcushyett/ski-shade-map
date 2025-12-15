'use client';

import { ReactNode } from 'react';
import { DownOutlined, RightOutlined } from '@ant-design/icons';

interface CollapsibleSectionProps {
  title: string;
  icon?: ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  badge?: ReactNode;
}

export function CollapsibleSection({
  title,
  icon,
  isExpanded,
  onToggle,
  children,
  badge,
}: CollapsibleSectionProps) {
  return (
    <div className={`collapsible-section ${isExpanded ? 'expanded' : ''}`}>
      <button className="collapsible-section-header" onClick={onToggle}>
        <span className="collapsible-section-icon">
          {isExpanded ? <DownOutlined style={{ fontSize: 9 }} /> : <RightOutlined style={{ fontSize: 9 }} />}
        </span>
        {icon && <span className="collapsible-section-title-icon">{icon}</span>}
        <span className="collapsible-section-title">{title}</span>
        {badge && <span className="collapsible-section-badge">{badge}</span>}
      </button>
      {isExpanded && (
        <div className="collapsible-section-content">
          {children}
        </div>
      )}
    </div>
  );
}

