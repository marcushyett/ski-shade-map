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

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('Failed to get supported resorts:', error);
    return NextResponse.json({ error: 'Failed to get supported resorts' }, { status: 500 });
  }
}
