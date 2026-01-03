'use client';

/**
 * Max Optimality Component
 *
 * Lazy-loaded entry point for the Max Optimality feature.
 * This component wraps the modal and can be dynamically imported
 * to avoid impacting initial page load.
 */

import dynamic from 'next/dynamic';
import type { MaxOptimalityPlan } from '@/lib/max-optimality/types';
import type { MountainHome } from '@/components/LocationControls';
import type { NavigationRoute } from '@/lib/navigation';

// Lazy load the modal component
const MaxOptimalityModal = dynamic(
  () => import('./MaxOptimalityModal').then((mod) => mod.MaxOptimalityModal),
  {
    ssr: false,
    loading: () => null,
  }
);

export interface MaxOptimalityProps {
  isOpen: boolean;
  onClose: () => void;
  onPlanComplete: (plan: MaxOptimalityPlan, route: NavigationRoute | null) => void;
  mountainHome: MountainHome | null;
}

export function MaxOptimality(props: MaxOptimalityProps) {
  return <MaxOptimalityModal {...props} />;
}

export default MaxOptimality;
