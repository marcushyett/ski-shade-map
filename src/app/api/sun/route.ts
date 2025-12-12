import { NextRequest, NextResponse } from 'next/server';
import { getSunPosition, getSunTimes, isSunUp } from '@/lib/suncalc';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lat = parseFloat(searchParams.get('lat') || '0');
  const lng = parseFloat(searchParams.get('lng') || '0');
  const timestamp = searchParams.get('timestamp');

  if (!lat || !lng) {
    return NextResponse.json(
      { error: 'Missing latitude or longitude' },
      { status: 400 }
    );
  }

  const date = timestamp ? new Date(parseInt(timestamp)) : new Date();

  const position = getSunPosition(date, lat, lng);
  const times = getSunTimes(date, lat, lng);
  const isUp = isSunUp(date, lat, lng);

  return NextResponse.json({
    position,
    times: {
      sunrise: times.sunrise.toISOString(),
      sunset: times.sunset.toISOString(),
      solarNoon: times.solarNoon.toISOString(),
      dawn: times.dawn.toISOString(),
      dusk: times.dusk.toISOString(),
    },
    isUp,
    requestedTime: date.toISOString(),
  });
}

