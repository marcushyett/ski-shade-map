import { NextResponse } from 'next/server';
import { getSupportedResorts } from 'ski-resort-status';

interface SupportedResort {
  id: string;
  name: string;
  openskimap_id: string | string[];
  platform: string;
}

export async function GET() {
  try {
    const resorts = getSupportedResorts() as SupportedResort[];

    const formatted = resorts.map(r => ({
      id: r.id,
      name: r.name,
      openskimapId: r.openskimap_id,
      platform: r.platform,
    }));

    console.log(`[LiftStatus] Supported resorts: ${formatted.length} resorts`);
    // Log a few examples with their openskimap IDs
    console.log('[LiftStatus] Sample supported resorts:', formatted.slice(0, 5).map(r => ({
      name: r.name,
      openskimapId: r.openskimapId,
    })));

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('[LiftStatus] Failed to get supported resorts:', error);
    return NextResponse.json({ error: 'Failed to get supported resorts' }, { status: 500 });
  }
}
