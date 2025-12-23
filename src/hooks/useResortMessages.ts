'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { trackEvent } from '@/lib/posthog';
import type { ResortStatus, LiftStatus, RunStatus } from '@/lib/lift-status-types';

const MESSAGES_STORAGE_KEY = 'ski-shade-acknowledged-messages';

export interface ResortMessage {
  id: string;  // Unique identifier: `${type}-${assetName}-${messageHash}`
  type: 'lift' | 'run';
  assetName: string;
  message: string;
  status: 'open' | 'closed' | 'scheduled' | 'unknown';
  liftType?: string;
  level?: string;  // Run difficulty level
}

interface AcknowledgedMessage {
  id: string;
  assetName: string;
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

// Extract messages from resort status
function extractMessages(resortStatus: ResortStatus | null): ResortMessage[] {
  if (!resortStatus) return [];

  const messages: ResortMessage[] = [];

  // Extract lift messages (only from closed or scheduled lifts with messages)
  resortStatus.lifts.forEach((lift: LiftStatus) => {
    if (lift.message && (lift.status === 'closed' || lift.status === 'scheduled')) {
      const id = `lift-${lift.name}-${hashMessage(lift.message)}`;
      messages.push({
        id,
        type: 'lift',
        assetName: lift.name,
        message: lift.message,
        status: lift.status as ResortMessage['status'],
        liftType: lift.liftType,
      });
    }
  });

  // Extract run messages (only from closed or scheduled runs with messages)
  resortStatus.runs.forEach((run: RunStatus) => {
    if (run.message && (run.status === 'closed' || run.status === 'scheduled')) {
      const id = `run-${run.name}-${hashMessage(run.message)}`;
      messages.push({
        id,
        type: 'run',
        assetName: run.name,
        message: run.message,
        status: run.status as ResortMessage['status'],
        level: run.level,
      });
    }
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
      message_type: message.type,
      asset_name: message.assetName,
      ski_area_id: skiAreaId,
    });

    const newAck: AcknowledgedMessage = {
      id: message.id,
      assetName: message.assetName,
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
      assetName: m.assetName,
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
