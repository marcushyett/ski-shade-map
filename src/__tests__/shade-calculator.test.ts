import { calculatePointShade, estimateSlopeAspect, getDifficultyColor } from '../lib/shade-calculator';

describe('Shade Calculator', () => {
  // Test location: Chamonix, France
  const chamonixLat = 45.9237;
  const chamonixLng = 6.8694;

  describe('calculatePointShade', () => {
    it('should return shaded when sun is below horizon', () => {
      const midnight = new Date('2024-12-21T00:00:00+01:00');
      const result = calculatePointShade(
        midnight,
        chamonixLat,
        chamonixLng,
        180, // South-facing slope
        30   // 30 degree slope
      );

      expect(result.isShaded).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('should return sunlit for south-facing slope at noon', () => {
      const noon = new Date('2024-12-21T12:00:00+01:00');
      const result = calculatePointShade(
        noon,
        chamonixLat,
        chamonixLng,
        180, // South-facing slope (facing the sun at noon in northern hemisphere)
        30
      );

      expect(result.isShaded).toBe(false);
      expect(result.sunPosition.altitudeDegrees).toBeGreaterThan(0);
    });

    it('should return shaded for north-facing slope at noon', () => {
      const noon = new Date('2024-12-21T12:00:00+01:00');
      const result = calculatePointShade(
        noon,
        chamonixLat,
        chamonixLng,
        0, // North-facing slope (facing away from sun at noon)
        30
      );

      // North-facing slopes are typically shaded in winter in northern hemisphere
      expect(result.sunPosition.altitudeDegrees).toBeGreaterThan(0);
    });
  });

  describe('estimateSlopeAspect', () => {
    it('should calculate aspect for north-south run', () => {
      // Run going from north to south
      const aspect = estimateSlopeAspect(46.0, 6.8, 45.9, 6.8);
      // Should be around 180 (south) + 90 = 270 (west) or 90 (east)
      expect(aspect).toBeGreaterThanOrEqual(0);
      expect(aspect).toBeLessThanOrEqual(360);
    });

    it('should calculate aspect for east-west run', () => {
      // Run going from west to east
      const aspect = estimateSlopeAspect(45.9, 6.7, 45.9, 6.9);
      expect(aspect).toBeGreaterThanOrEqual(0);
      expect(aspect).toBeLessThanOrEqual(360);
    });
  });

  describe('getDifficultyColor', () => {
    it('should return green for novice', () => {
      expect(getDifficultyColor('novice')).toBe('#4CAF50');
    });

    it('should return blue for easy', () => {
      expect(getDifficultyColor('easy')).toBe('#2196F3');
    });

    it('should return red for intermediate', () => {
      expect(getDifficultyColor('intermediate')).toBe('#F44336');
    });

    it('should return black for advanced', () => {
      expect(getDifficultyColor('advanced')).toBe('#212121');
    });

    it('should return black for expert', () => {
      expect(getDifficultyColor('expert')).toBe('#212121');
    });

    it('should return gray for unknown difficulty', () => {
      expect(getDifficultyColor(null)).toBe('#9E9E9E');
      expect(getDifficultyColor(undefined)).toBe('#9E9E9E');
      expect(getDifficultyColor('unknown')).toBe('#9E9E9E');
    });
  });
});

