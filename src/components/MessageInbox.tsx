'use client';

import { useState, memo } from 'react';
import { Badge, Drawer, Tooltip, Empty } from 'antd';
import {
  MailOutlined,
  CheckOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import type { ResortMessage, AffectedAsset } from '@/hooks/useResortMessages';

// Detect touch device to disable tooltips (they require double-tap on mobile)
const isTouchDevice = () => {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
};

// Wrapper that only shows tooltip on non-touch devices
const MobileAwareTooltip = ({ title, children, ...props }: React.ComponentProps<typeof Tooltip>) => {
  if (isTouchDevice()) {
    return <>{children}</>;
  }
  return <Tooltip title={title} {...props}>{children}</Tooltip>;
};

// Status icon component
const StatusIcon = memo(function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'closed':
      return <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 10 }} />;
    case 'scheduled':
      return <ClockCircleOutlined style={{ color: '#faad14', fontSize: 10 }} />;
    case 'open':
      return <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 10 }} />;
    default:
      return null;
  }
});

// Difficulty color for runs
function getDifficultyColor(level: string | undefined): string {
  switch (level?.toUpperCase()) {
    case 'GREEN':
      return '#22c55e';
    case 'BLUE':
      return '#3b82f6';
    case 'RED':
      return '#ef4444';
    case 'BLACK':
      return '#1a1a1a';
    default:
      return '#888';
  }
}

// Affected asset pill
const AssetPill = memo(function AssetPill({ asset }: { asset: AffectedAsset }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 9,
        background: 'rgba(255,255,255,0.1)',
        padding: '2px 6px',
        borderRadius: 4,
        marginRight: 4,
        marginBottom: 4,
      }}
    >
      <StatusIcon status={asset.status} />
      {asset.type === 'run' && asset.level && (
        <span style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: getDifficultyColor(asset.level),
          flexShrink: 0,
        }} />
      )}
      <span style={{ color: '#ccc' }}>{asset.name}</span>
      {asset.type === 'lift' && asset.liftType && (
        <span style={{ color: '#666', fontSize: 8 }}>({asset.liftType})</span>
      )}
    </span>
  );
});

interface MessageItemProps {
  message: ResortMessage;
  isRead: boolean;
  onAcknowledge: () => void;
}

const MessageItem = memo(function MessageItem({ message, isRead, onAcknowledge }: MessageItemProps) {
  const totalAffected = message.liftCount + message.runCount;
  const showAllAssets = message.affectedAssets.length <= 5;
  const displayAssets = showAllAssets ? message.affectedAssets : message.affectedAssets.slice(0, 3);
  const hiddenCount = message.affectedAssets.length - displayAssets.length;

  return (
    <div
      className={`message-item ${isRead ? 'read' : 'unread'}`}
      style={{
        padding: '10px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        background: isRead ? 'transparent' : 'rgba(59, 130, 246, 0.1)',
      }}
    >
      {/* Header with counts */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {message.liftCount > 0 && (
            <span style={{
              fontSize: 9,
              color: '#888',
              background: 'rgba(255,255,255,0.1)',
              padding: '1px 6px',
              borderRadius: 3,
            }}>
              {message.liftCount} lift{message.liftCount > 1 ? 's' : ''}
            </span>
          )}
          {message.runCount > 0 && (
            <span style={{
              fontSize: 9,
              color: '#888',
              background: 'rgba(255,255,255,0.1)',
              padding: '1px 6px',
              borderRadius: 3,
            }}>
              {message.runCount} run{message.runCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {!isRead && (
          <button
            onClick={onAcknowledge}
            style={{
              background: 'rgba(59, 130, 246, 0.2)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: 4,
              padding: '4px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: '#3b82f6',
              fontSize: 10,
              flexShrink: 0,
            }}
            aria-label="Mark as read"
          >
            <CheckOutlined style={{ fontSize: 10 }} />
          </button>
        )}
      </div>

      {/* Message content */}
      <p style={{
        fontSize: 11,
        color: '#ddd',
        margin: '0 0 8px 0',
        lineHeight: 1.4,
      }}>
        {message.message}
      </p>

      {/* Affected assets */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
        {displayAssets.map((asset, index) => (
          <AssetPill key={`${asset.type}-${asset.name}-${index}`} asset={asset} />
        ))}
        {hiddenCount > 0 && (
          <MobileAwareTooltip
            title={message.affectedAssets.slice(3).map(a => a.name).join(', ')}
            placement="top"
          >
            <span style={{
              fontSize: 9,
              color: '#666',
              padding: '2px 6px',
              cursor: 'help',
            }}>
              +{hiddenCount} more
            </span>
          </MobileAwareTooltip>
        )}
      </div>
    </div>
  );
});

interface MessageInboxButtonProps {
  unreadCount: number;
  onClick: () => void;
}

export const MessageInboxButton = memo(function MessageInboxButton({
  unreadCount,
  onClick,
}: MessageInboxButtonProps) {
  return (
    <MobileAwareTooltip title={unreadCount > 0 ? `${unreadCount} new message${unreadCount > 1 ? 's' : ''}` : 'Resort messages'} placement="left">
      <button
        className="message-inbox-btn"
        onClick={onClick}
        aria-label={`Resort messages${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: unreadCount > 0 ? 'rgba(59, 130, 246, 0.2)' : 'rgba(0, 0, 0, 0.6)',
          border: unreadCount > 0 ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255, 255, 255, 0.2)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          transition: 'all 0.2s',
        }}
      >
        <Badge count={unreadCount} size="small" offset={[2, -2]}>
          <MailOutlined style={{
            fontSize: 14,
            color: unreadCount > 0 ? '#3b82f6' : '#fff',
          }} />
        </Badge>
      </button>
    </MobileAwareTooltip>
  );
});

interface MessageInboxDrawerProps {
  open: boolean;
  onClose: () => void;
  allMessages: ResortMessage[];
  unreadMessages: ResortMessage[];
  readMessages: ResortMessage[];
  onAcknowledge: (message: ResortMessage) => void;
  onAcknowledgeAll: () => void;
  skiAreaName: string | null;
}

export const MessageInboxDrawer = memo(function MessageInboxDrawer({
  open,
  onClose,
  allMessages,
  unreadMessages,
  readMessages,
  onAcknowledge,
  onAcknowledgeAll,
  skiAreaName,
}: MessageInboxDrawerProps) {
  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>
            <MailOutlined style={{ marginRight: 8, color: '#3b82f6' }} />
            Resort Messages
          </span>
          {unreadMessages.length > 0 && (
            <button
              onClick={onAcknowledgeAll}
              style={{
                background: 'none',
                border: 'none',
                color: '#3b82f6',
                fontSize: 10,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <CheckOutlined style={{ fontSize: 10 }} />
              Mark all read
            </button>
          )}
        </div>
      }
      placement="right"
      onClose={onClose}
      open={open}
      width={340}
      styles={{
        body: { padding: 0 },
        header: { padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)' },
      }}
    >
      {allMessages.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ fontSize: 11, color: '#666' }}>
              No messages from {skiAreaName || 'this resort'}
            </span>
          }
          style={{ marginTop: 40 }}
        />
      ) : (
        <div>
          {unreadMessages.length > 0 && (
            <div>
              <div style={{
                fontSize: 9,
                color: '#888',
                padding: '8px 12px',
                background: 'rgba(0,0,0,0.2)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                Unread ({unreadMessages.length})
              </div>
              {unreadMessages.map(msg => (
                <MessageItem
                  key={msg.id}
                  message={msg}
                  isRead={false}
                  onAcknowledge={() => onAcknowledge(msg)}
                />
              ))}
            </div>
          )}
          {readMessages.length > 0 && (
            <div>
              <div style={{
                fontSize: 9,
                color: '#666',
                padding: '8px 12px',
                background: 'rgba(0,0,0,0.2)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                Read ({readMessages.length})
              </div>
              {readMessages.map(msg => (
                <MessageItem
                  key={msg.id}
                  message={msg}
                  isRead={true}
                  onAcknowledge={() => {}}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
});

interface MessageInboxProps {
  allMessages: ResortMessage[];
  unreadMessages: ResortMessage[];
  readMessages: ResortMessage[];
  unreadCount: number;
  onAcknowledge: (message: ResortMessage) => void;
  onAcknowledgeAll: () => void;
  skiAreaName: string | null;
  hasLiveStatus: boolean;
}

function MessageInboxInner({
  allMessages,
  unreadMessages,
  readMessages,
  unreadCount,
  onAcknowledge,
  onAcknowledgeAll,
  skiAreaName,
  hasLiveStatus,
}: MessageInboxProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Don't render if resort doesn't have live status
  if (!hasLiveStatus) {
    return null;
  }

  return (
    <>
      <MessageInboxButton
        unreadCount={unreadCount}
        onClick={() => setIsOpen(true)}
      />
      <MessageInboxDrawer
        open={isOpen}
        onClose={() => setIsOpen(false)}
        allMessages={allMessages}
        unreadMessages={unreadMessages}
        readMessages={readMessages}
        onAcknowledge={onAcknowledge}
        onAcknowledgeAll={onAcknowledgeAll}
        skiAreaName={skiAreaName}
      />
    </>
  );
}

const MessageInbox = memo(MessageInboxInner);
export default MessageInbox;
