import { getSunPosition, getSunTimes, isSunUp, getShadowDirection, getShadowLengthFactor } from '../lib/suncalc';

describe('SunCalc utilities', () => {
  // Test location: Chamonix, France
  const chamonixLat = 45.9237;
  const chamonixLng = 6.8694;

  describe('getSunPosition', () => {
    it('should return valid sun position at solar noon', () => {
      // December 21st (winter solstice) at noon
      const date = new Date('2024-12-21T12:00:00+01:00');
      const pos = getSunPosition(date, chamonixLat, chamonixLng);

      expect(pos.azimuthDegrees).toBeGreaterThanOrEqual(0);
      expect(pos.azimuthDegrees).toBeLessThanOrEqual(360);
      expect(pos.altitudeDegrees).toBeGreaterThan(0); // Sun should be up at noon
      expect(pos.altitudeDegrees).toBeLessThan(90);
    });

    it('should return negative altitude at midnight', () => {
      const date = new Date('2024-12-21T00:00:00+01:00');
      const pos = getSunPosition(date, chamonixLat, chamonixLng);

      expect(pos.altitudeDegrees).toBeLessThan(0); // Sun should be below horizon
    });

    it('should show sun highest in summer', () => {
      const winter = new Date('2024-12-21T12:00:00+01:00');
      const summer = new Date('2024-06-21T12:00:00+02:00');

      const winterPos = getSunPosition(winter, chamonixLat, chamonixLng);
      const summerPos = getSunPosition(summer, chamonixLat, chamonixLng);

      expect(summerPos.altitudeDegrees).toBeGreaterThan(winterPos.altitudeDegrees);
    });
  });

  describe('getSunTimes', () => {
    it('should return valid sunrise and sunset times', () => {
      const date = new Date('2024-12-21T12:00:00+01:00');
      const times = getSunTimes(date, chamonixLat, chamonixLng);

      expect(times.sunrise).toBeInstanceOf(Date);
      expect(times.sunset).toBeInstanceOf(Date);
      expect(times.solarNoon).toBeInstanceOf(Date);
      expect(times.sunrise.getTime()).toBeLessThan(times.sunset.getTime());
    });

    it('should have shorter days in winter', () => {
      const winter = new Date('2024-12-21T12:00:00+01:00');
      const summer = new Date('2024-06-21T12:00:00+02:00');

      const winterTimes = getSunTimes(winter, chamonixLat, chamonixLng);
      const summerTimes = getSunTimes(summer, chamonixLat, chamonixLng);

      const winterDayLength = winterTimes.sunset.getTime() - winterTimes.sunrise.getTime();
      const summerDayLength = summerTimes.sunset.getTime() - summerTimes.sunrise.getTime();

      expect(summerDayLength).toBeGreaterThan(winterDayLength);
    });
  });

  describe('isSunUp', () => {
    it('should return true at noon', () => {
      const date = new Date('2024-12-21T12:00:00+01:00');
      expect(isSunUp(date, chamonixLat, chamonixLng)).toBe(true);
    });

    it('should return false at midnight', () => {
      const date = new Date('2024-12-21T00:00:00+01:00');
      expect(isSunUp(date, chamonixLat, chamonixLng)).toBe(false);
    });
  });

  describe('getShadowDirection', () => {
    it('should return opposite direction of sun', () => {
      expect(getShadowDirection(0)).toBe(180);
      expect(getShadowDirection(90)).toBe(270);
      expect(getShadowDirection(180)).toBe(0);
      expect(getShadowDirection(270)).toBe(90);
    });
  });

  describe('getShadowLengthFactor', () => {
    it('should return infinity when sun is at or below horizon', () => {
      expect(getShadowLengthFactor(0)).toBe(Infinity);
      expect(getShadowLengthFactor(-10)).toBe(Infinity);
    });

    it('should return shorter shadows with higher sun', () => {
      const lowSun = getShadowLengthFactor(15);
      const highSun = getShadowLengthFactor(45);

      expect(lowSun).toBeGreaterThan(highSun);
    });

    it('should return 1 when sun is at 45 degrees', () => {
      const factor = getShadowLengthFactor(45);
      expect(factor).toBeCloseTo(1, 5);
    });
  });
});

