import { describe, it, expect } from 'vitest';
import {
  parseCamelotKey,
  classifyCamelotRelationship,
  getCompatibleCamelotKeys,
  getCamelotRelationshipLabel,
  getCamelotRelationshipScore,
  type CamelotRelationship,
} from './camelot';

// ── parseCamelotKey ────────────────────────────────────────────────────────────

describe('parseCamelotKey', () => {
  it('parses standard uppercase keys', () => {
    expect(parseCamelotKey('8A')).toEqual({ number: 8, mode: 'A', code: '8A' });
    expect(parseCamelotKey('8B')).toEqual({ number: 8, mode: 'B', code: '8B' });
    expect(parseCamelotKey('1A')).toEqual({ number: 1, mode: 'A', code: '1A' });
    expect(parseCamelotKey('12A')).toEqual({ number: 12, mode: 'A', code: '12A' });
    expect(parseCamelotKey('12B')).toEqual({ number: 12, mode: 'B', code: '12B' });
  });

  it('parses lowercase mode letters', () => {
    expect(parseCamelotKey('8a')).toEqual({ number: 8, mode: 'A', code: '8A' });
    expect(parseCamelotKey('8b')).toEqual({ number: 8, mode: 'B', code: '8B' });
    expect(parseCamelotKey('12b')).toEqual({ number: 12, mode: 'B', code: '12B' });
  });

  it('trims surrounding whitespace', () => {
    expect(parseCamelotKey('  8A  ')).toEqual({ number: 8, mode: 'A', code: '8A' });
    expect(parseCamelotKey('\t12B\n')).toEqual({ number: 12, mode: 'B', code: '12B' });
  });

  it('parses all 24 valid codes', () => {
    for (let n = 1; n <= 12; n++) {
      expect(parseCamelotKey(`${n}A`)).toEqual({ number: n, mode: 'A', code: `${n}A` });
      expect(parseCamelotKey(`${n}B`)).toEqual({ number: n, mode: 'B', code: `${n}B` });
    }
  });

  it('returns null for null and undefined', () => {
    expect(parseCamelotKey(null)).toBeNull();
    expect(parseCamelotKey(undefined)).toBeNull();
  });

  it('returns null for empty and blank strings', () => {
    expect(parseCamelotKey('')).toBeNull();
    expect(parseCamelotKey('   ')).toBeNull();
  });

  it('returns null for out-of-range numbers', () => {
    expect(parseCamelotKey('0A')).toBeNull();
    expect(parseCamelotKey('13A')).toBeNull();
    expect(parseCamelotKey('99B')).toBeNull();
  });

  it('returns null for invalid mode letters', () => {
    expect(parseCamelotKey('8C')).toBeNull();
    expect(parseCamelotKey('8M')).toBeNull();
  });

  it('returns null for non-key strings', () => {
    expect(parseCamelotKey('A minor')).toBeNull();
    expect(parseCamelotKey('invalid')).toBeNull();
    expect(parseCamelotKey('8')).toBeNull();
    expect(parseCamelotKey('A')).toBeNull();
  });
});

// ── classifyCamelotRelationship ────────────────────────────────────────────────

describe('classifyCamelotRelationship', () => {

  // ── Exact ──────────────────────────────────────────────────────────────────

  it('classifies same key as exact', () => {
    expect(classifyCamelotRelationship('8A', '8A')).toBe('exact');
    expect(classifyCamelotRelationship('8B', '8B')).toBe('exact');
    expect(classifyCamelotRelationship('1A', '1A')).toBe('exact');
    expect(classifyCamelotRelationship('12B', '12B')).toBe('exact');
  });

  // ── Relative ───────────────────────────────────────────────────────────────

  it('classifies same number opposite mode as relative', () => {
    expect(classifyCamelotRelationship('8A', '8B')).toBe('relative');
    expect(classifyCamelotRelationship('8B', '8A')).toBe('relative');
    expect(classifyCamelotRelationship('1A', '1B')).toBe('relative');
    expect(classifyCamelotRelationship('12A', '12B')).toBe('relative');
    expect(classifyCamelotRelationship('12B', '12A')).toBe('relative');
  });

  // ── Adjacent up ───────────────────────────────────────────────────────────

  it('classifies +1 same mode as adjacent_up', () => {
    expect(classifyCamelotRelationship('8A', '9A')).toBe('adjacent_up');
    expect(classifyCamelotRelationship('8B', '9B')).toBe('adjacent_up');
    expect(classifyCamelotRelationship('1A', '2A')).toBe('adjacent_up');
    expect(classifyCamelotRelationship('11A', '12A')).toBe('adjacent_up');
  });

  it('wraps 12 → 1 for adjacent_up', () => {
    expect(classifyCamelotRelationship('12A', '1A')).toBe('adjacent_up');
    expect(classifyCamelotRelationship('12B', '1B')).toBe('adjacent_up');
  });

  // ── Adjacent down ─────────────────────────────────────────────────────────

  it('classifies −1 same mode as adjacent_down', () => {
    expect(classifyCamelotRelationship('8A', '7A')).toBe('adjacent_down');
    expect(classifyCamelotRelationship('8B', '7B')).toBe('adjacent_down');
    expect(classifyCamelotRelationship('2A', '1A')).toBe('adjacent_down');
    expect(classifyCamelotRelationship('12A', '11A')).toBe('adjacent_down');
  });

  it('wraps 1 → 12 for adjacent_down', () => {
    expect(classifyCamelotRelationship('1A', '12A')).toBe('adjacent_down');
    expect(classifyCamelotRelationship('1B', '12B')).toBe('adjacent_down');
  });

  // ── Energy boost ───────────────────────────────────────────────────────────

  it('classifies +2 same mode as energy_boost', () => {
    expect(classifyCamelotRelationship('8A', '10A')).toBe('energy_boost');
    expect(classifyCamelotRelationship('8B', '10B')).toBe('energy_boost');
    expect(classifyCamelotRelationship('1A', '3A')).toBe('energy_boost');
    expect(classifyCamelotRelationship('10A', '12A')).toBe('energy_boost');
  });

  it('wraps 12 → 2 for energy_boost', () => {
    expect(classifyCamelotRelationship('12A', '2A')).toBe('energy_boost');
    expect(classifyCamelotRelationship('12B', '2B')).toBe('energy_boost');
  });

  it('wraps 11 → 1 for energy_boost', () => {
    expect(classifyCamelotRelationship('11A', '1A')).toBe('energy_boost');
    expect(classifyCamelotRelationship('11B', '1B')).toBe('energy_boost');
  });

  // ── Incompatible ──────────────────────────────────────────────────────────

  it('classifies unrelated keys as incompatible', () => {
    expect(classifyCamelotRelationship('8A', '3A')).toBe('incompatible');
    expect(classifyCamelotRelationship('8A', '5B')).toBe('incompatible');
    expect(classifyCamelotRelationship('1A', '7B')).toBe('incompatible');
    expect(classifyCamelotRelationship('12A', '10B')).toBe('incompatible');
  });

  it('does not classify +2 opposite mode as energy_boost', () => {
    // Energy boost is same-mode only
    expect(classifyCamelotRelationship('8A', '10B')).toBe('incompatible');
    expect(classifyCamelotRelationship('12A', '2B')).toBe('incompatible');
  });

  // ── Unknown ───────────────────────────────────────────────────────────────

  it('returns unknown when source is null or invalid', () => {
    expect(classifyCamelotRelationship(null, '8A')).toBe('unknown');
    expect(classifyCamelotRelationship(undefined, '8A')).toBe('unknown');
    expect(classifyCamelotRelationship('', '8A')).toBe('unknown');
    expect(classifyCamelotRelationship('invalid', '8A')).toBe('unknown');
  });

  it('returns unknown when candidate is null or invalid', () => {
    expect(classifyCamelotRelationship('8A', null)).toBe('unknown');
    expect(classifyCamelotRelationship('8A', undefined)).toBe('unknown');
    expect(classifyCamelotRelationship('8A', '')).toBe('unknown');
    expect(classifyCamelotRelationship('8A', 'invalid')).toBe('unknown');
  });

  it('returns unknown when both are null', () => {
    expect(classifyCamelotRelationship(null, null)).toBe('unknown');
  });
});

// ── Specification examples from the task ──────────────────────────────────────

describe('task specification examples', () => {
  describe('source 12A', () => {
    it.each([
      ['12A', 'exact'],
      ['12B', 'relative'],
      ['1A',  'adjacent_up'],
      ['11A', 'adjacent_down'],
      ['2A',  'energy_boost'],
    ] as [string, CamelotRelationship][])('12A → %s = %s', (candidate, expected) => {
      expect(classifyCamelotRelationship('12A', candidate)).toBe(expected);
    });
  });

  describe('source 1A', () => {
    it.each([
      ['1A',  'exact'],
      ['1B',  'relative'],
      ['2A',  'adjacent_up'],
      ['12A', 'adjacent_down'],
      ['3A',  'energy_boost'],
    ] as [string, CamelotRelationship][])('1A → %s = %s', (candidate, expected) => {
      expect(classifyCamelotRelationship('1A', candidate)).toBe(expected);
    });
  });
});

// ── All 12 numbers, both modes ─────────────────────────────────────────────────

describe('classifyCamelotRelationship — all 12 positions', () => {
  function wrap(n: number) {
    return ((n - 1 + 12) % 12) + 1;
  }

  for (const mode of ['A', 'B'] as const) {
    describe(`mode ${mode}`, () => {
      for (let n = 1; n <= 12; n++) {
        const src = `${n}${mode}`;
        const oppMode = mode === 'A' ? 'B' : 'A';

        it(`${src}: exact, relative, adjacent_up, adjacent_down, energy_boost`, () => {
          expect(classifyCamelotRelationship(src, src)).toBe('exact');
          expect(classifyCamelotRelationship(src, `${n}${oppMode}`)).toBe('relative');
          expect(classifyCamelotRelationship(src, `${wrap(n + 1)}${mode}`)).toBe('adjacent_up');
          expect(classifyCamelotRelationship(src, `${wrap(n - 1)}${mode}`)).toBe('adjacent_down');
          expect(classifyCamelotRelationship(src, `${wrap(n + 2)}${mode}`)).toBe('energy_boost');
        });
      }
    });
  }
});

// ── getCompatibleCamelotKeys ───────────────────────────────────────────────────

describe('getCompatibleCamelotKeys', () => {
  it('returns 5 entries for a valid key', () => {
    expect(getCompatibleCamelotKeys('8A')).toHaveLength(5);
  });

  it('returns correct set for 12A', () => {
    const result = getCompatibleCamelotKeys('12A');
    expect(result).toEqual([
      { code: '12A', relationship: 'exact'         },
      { code: '12B', relationship: 'relative'      },
      { code: '1A',  relationship: 'adjacent_up'   },
      { code: '11A', relationship: 'adjacent_down' },
      { code: '2A',  relationship: 'energy_boost'  },
    ]);
  });

  it('returns correct set for 1A', () => {
    const result = getCompatibleCamelotKeys('1A');
    expect(result).toEqual([
      { code: '1A',  relationship: 'exact'         },
      { code: '1B',  relationship: 'relative'      },
      { code: '2A',  relationship: 'adjacent_up'   },
      { code: '12A', relationship: 'adjacent_down' },
      { code: '3A',  relationship: 'energy_boost'  },
    ]);
  });

  it('returns correct set for 1B (major wrap-around)', () => {
    const result = getCompatibleCamelotKeys('1B');
    expect(result).toEqual([
      { code: '1B',  relationship: 'exact'         },
      { code: '1A',  relationship: 'relative'      },
      { code: '2B',  relationship: 'adjacent_up'   },
      { code: '12B', relationship: 'adjacent_down' },
      { code: '3B',  relationship: 'energy_boost'  },
    ]);
  });

  it('returns correct set for 11B (energy boost wraps to 1B)', () => {
    const result = getCompatibleCamelotKeys('11B');
    expect(result).toEqual([
      { code: '11B', relationship: 'exact'         },
      { code: '11A', relationship: 'relative'      },
      { code: '12B', relationship: 'adjacent_up'   },
      { code: '10B', relationship: 'adjacent_down' },
      { code: '1B',  relationship: 'energy_boost'  },
    ]);
  });

  it('all returned codes are parseable Camelot keys', () => {
    for (let n = 1; n <= 12; n++) {
      for (const mode of ['A', 'B'] as const) {
        const compatible = getCompatibleCamelotKeys(`${n}${mode}`);
        for (const { code } of compatible) {
          expect(parseCamelotKey(code)).not.toBeNull();
        }
      }
    }
  });

  it('all returned codes classify correctly against the source', () => {
    for (let n = 1; n <= 12; n++) {
      for (const mode of ['A', 'B'] as const) {
        const src = `${n}${mode}`;
        const compatible = getCompatibleCamelotKeys(src);
        for (const { code, relationship } of compatible) {
          expect(classifyCamelotRelationship(src, code)).toBe(relationship);
        }
      }
    }
  });

  it('returns empty array for null', () => {
    expect(getCompatibleCamelotKeys(null)).toEqual([]);
  });

  it('returns empty array for invalid input', () => {
    expect(getCompatibleCamelotKeys('')).toEqual([]);
    expect(getCompatibleCamelotKeys('invalid')).toEqual([]);
    expect(getCompatibleCamelotKeys('13A')).toEqual([]);
  });
});

// ── getCamelotRelationshipLabel ────────────────────────────────────────────────

describe('getCamelotRelationshipLabel', () => {
  const cases: [CamelotRelationship, string][] = [
    ['exact',         'Perfect Match'],
    ['relative',      'Relative Key'],
    ['adjacent_up',   'Step Up'],
    ['adjacent_down', 'Step Down'],
    ['energy_boost',  'Energy Boost'],
    ['incompatible',  'Incompatible'],
    ['unknown',       'Unknown'],
  ];

  it.each(cases)('%s → "%s"', (rel, label) => {
    expect(getCamelotRelationshipLabel(rel)).toBe(label);
  });
});

// ── getCamelotRelationshipScore ────────────────────────────────────────────────

describe('getCamelotRelationshipScore', () => {
  it('returns 1.00 for exact', () => {
    expect(getCamelotRelationshipScore('exact')).toBe(1.00);
  });

  it('returns 0.95 for relative', () => {
    expect(getCamelotRelationshipScore('relative')).toBe(0.95);
  });

  it('returns 0.92 for adjacent_up', () => {
    expect(getCamelotRelationshipScore('adjacent_up')).toBe(0.92);
  });

  it('returns 0.90 for adjacent_down', () => {
    expect(getCamelotRelationshipScore('adjacent_down')).toBe(0.90);
  });

  it('returns 0.72 for energy_boost', () => {
    expect(getCamelotRelationshipScore('energy_boost')).toBe(0.72);
  });

  it('returns 0 for incompatible', () => {
    expect(getCamelotRelationshipScore('incompatible')).toBe(0);
  });

  it('returns 0 for unknown', () => {
    expect(getCamelotRelationshipScore('unknown')).toBe(0);
  });

  it('scores are in descending compatibility order', () => {
    const scores = [
      getCamelotRelationshipScore('exact'),
      getCamelotRelationshipScore('relative'),
      getCamelotRelationshipScore('adjacent_up'),
      getCamelotRelationshipScore('adjacent_down'),
      getCamelotRelationshipScore('energy_boost'),
    ];
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });
});
