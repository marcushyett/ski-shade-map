'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { trackEvent } from '@/lib/posthog';
import type { ResortStatus, LiftStatus, RunStatus } from '@/lib/lift-status-types';

const MESSAGES_STORAGE_KEY = 'ski-shade-acknowledged-messages';

export interface AffectedAsset {
  name: string;
  type: 'lift' | 'run';
  status: 'open' | 'closed' | 'scheduled' | 'unknown';
  liftType?: string;
  level?: string;
}

export interface ResortMessage {
  id: string;  // Unique identifier based on message content hash
  message: string;
  affectedAssets: AffectedAsset[];
  liftCount: number;
  runCount: number;
}

interface AcknowledgedMessage {
  id: string;
  message: string;
  acknowledgedAt: number;
}

interface AcknowledgedMessagesState {
  [skiAreaId: string]: AcknowledgedMessage[];
}

// Simple hash function for creating unique message IDs
function hashMessage(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

// Load acknowledged messages from localStorage
function loadAcknowledgedMessages(): AcknowledgedMessagesState {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(MESSAGES_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore localStorage errors
  }
  return {};
}

// Extract and deduplicate messages from resort status
function extractMessages(resortStatus: ResortStatus | null): ResortMessage[] {
  if (!resortStatus) return [];

  // Group by message content to deduplicate
  const messageMap = new Map<string, { message: string; assets: AffectedAsset[] }>();

  // Extract lift messages
  resortStatus.lifts.forEach((lift: LiftStatus) => {
    if (lift.message && lift.message.trim()) {
      const normalizedMessage = lift.message.trim();
      const existing = messageMap.get(normalizedMessage);

      const asset: AffectedAsset = {
        name: lift.name,
        type: 'lift',
        status: (lift.status as AffectedAsset['status']) || 'unknown',
        liftType: lift.liftType,
      };

      if (existing) {
        existing.assets.push(asset);
      } else {
        messageMap.set(normalizedMessage, {
          message: normalizedMessage,
          assets: [asset],
        });
      }
    }
  });

  // Extract run messages
  resortStatus.runs.forEach((run: RunStatus) => {
    if (run.message && run.message.trim()) {
      const normalizedMessage = run.message.trim();
      const existing = messageMap.get(normalizedMessage);

      const asset: AffectedAsset = {
        name: run.name,
        type: 'run',
        status: (run.status as AffectedAsset['status']) || 'unknown',
        level: run.level,
      };

      if (existing) {
        existing.assets.push(asset);
      } else {
        messageMap.set(normalizedMessage, {
          message: normalizedMessage,
          assets: [asset],
        });
      }
    }
  });

  // Convert to array format
  const messages: ResortMessage[] = [];
  messageMap.forEach(({ message, assets }) => {
    const liftCount = assets.filter(a => a.type === 'lift').length;
    const runCount = assets.filter(a => a.type === 'run').length;

    messages.push({
      id: `msg-${hashMessage(message)}`,
      message,
      affectedAssets: assets,
      liftCount,
      runCount,
    });
  });

  return messages;
}

export function useResortMessages(skiAreaId: string | null, resortStatus: ResortStatus | null) {
  const [acknowledgedMessages, setAcknowledgedMessages] = useState<AcknowledgedMessagesState>(() =>
    loadAcknowledgedMessages()
  );

  // Extract all current messages from resort status
  const allMessages = useMemo(() => extractMessages(resortStatus), [resortStatus]);

  // Get acknowledged message IDs for this ski area
  const acknowledgedIds = useMemo(() => {
    if (!skiAreaId) return new Set<string>();
    const ackMessages = acknowledgedMessages[skiAreaId] || [];
    return new Set(ackMessages.map((m: AcknowledgedMessage) => m.id));
  }, [acknowledgedMessages, skiAreaId]);

  // Get unread messages (messages not yet acknowledged)
  const unreadMessages = useMemo(() => {
    return allMessages.filter(m => !acknowledgedIds.has(m.id));
  }, [allMessages, acknowledgedIds]);

  // Get read messages (for showing in inbox)
  const readMessages = useMemo(() => {
    return allMessages.filter(m => acknowledgedIds.has(m.id));
  }, [allMessages, acknowledgedIds]);

  // Unread count
  const unreadCount = unreadMessages.length;

  // Save acknowledged messages to localStorage
  const saveAcknowledgedMessages = useCallback((newState: AcknowledgedMessagesState) => {
    try {
      localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(newState));
      setAcknowledgedMessages(newState);
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Mark a message as read/acknowledged
  const acknowledgeMessage = useCallback((message: ResortMessage) => {
    if (!skiAreaId) return;

    const currentAck = acknowledgedMessages[skiAreaId] || [];

    // Check if already acknowledged
    if (currentAck.some((m: AcknowledgedMessage) => m.id === message.id)) return;

    trackEvent('message_acknowledged', {
      message_id: message.id,
      message_type: message.liftCount > 0 ? 'lift' : 'run',
      ski_area_id: skiAreaId,
    });

    const newAck: AcknowledgedMessage = {
      id: message.id,
      message: message.message,
      acknowledgedAt: Date.now(),
    };

    const newState = {
      ...acknowledgedMessages,
      [skiAreaId]: [...currentAck, newAck],
    };

    saveAcknowledgedMessages(newState);
  }, [skiAreaId, acknowledgedMessages, saveAcknowledgedMessages]);

  // Mark all messages as read
  const acknowledgeAllMessages = useCallback(() => {
    if (!skiAreaId || unreadMessages.length === 0) return;

    trackEvent('all_messages_acknowledged', {
      message_count: unreadMessages.length,
      ski_area_id: skiAreaId,
    });

    const currentAck = acknowledgedMessages[skiAreaId] || [];
    const newAckMessages: AcknowledgedMessage[] = unreadMessages.map((m: ResortMessage) => ({
      id: m.id,
      message: m.message,
      acknowledgedAt: Date.now(),
    }));

    const newState = {
      ...acknowledgedMessages,
      [skiAreaId]: [...currentAck, ...newAckMessages],
    };

    saveAcknowledgedMessages(newState);
  }, [skiAreaId, acknowledgedMessages, unreadMessages, saveAcknowledgedMessages]);

  // Clear old acknowledged messages that are no longer in the current status
  // (e.g., if a lift reopened and the message is no longer relevant)
  useEffect(() => {
    if (!skiAreaId || !resortStatus) return;

    const currentMessageIds = new Set(allMessages.map((m: ResortMessage) => m.id));
    const ackMessages = acknowledgedMessages[skiAreaId] || [];

    // Filter out acknowledged messages that are no longer in current status
    const stillRelevant = ackMessages.filter((m: AcknowledgedMessage) => currentMessageIds.has(m.id));

    if (stillRelevant.length !== ackMessages.length) {
      const newState = {
        ...acknowledgedMessages,
        [skiAreaId]: stillRelevant,
      };

      // Clean up empty arrays
      if (stillRelevant.length === 0) {
        delete newState[skiAreaId];
      }

      saveAcknowledgedMessages(newState);
    }
  }, [skiAreaId, resortStatus, allMessages, acknowledgedMessages, saveAcknowledgedMessages]);

  return {
    allMessages,
    unreadMessages,
    readMessages,
    unreadCount,
    acknowledgeMessage,
    acknowledgeAllMessages,
  };
}
