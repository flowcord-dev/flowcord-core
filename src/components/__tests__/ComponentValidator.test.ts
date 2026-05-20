/**
 * Unit tests for ComponentValidator — layout and embed validation rules.
 */
import { validateLayout, validateEmbeds } from '../ComponentValidator';
import type { ComponentConfig } from '../../types';

// ---------------------------------------------------------------------------
// validateEmbeds
// ---------------------------------------------------------------------------

describe('validateEmbeds', () => {
  it('is valid with 5 action rows (limit)', () => {
    const result = validateEmbeds(5, 'test-menu');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.componentCount).toBe(5);
  });

  it('is invalid with 6 action rows (over limit)', () => {
    const result = validateEmbeds(6, 'test-menu');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('6 action rows');
  });

  it('is valid with 0 action rows', () => {
    const result = validateEmbeds(0, 'test-menu');
    expect(result.valid).toBe(true);
    expect(result.componentCount).toBe(0);
  });

  it('includes menu id in error message', () => {
    const result = validateEmbeds(6, 'my-special-menu');
    expect(result.errors[0]).toContain('my-special-menu');
  });
});

// ---------------------------------------------------------------------------
// validateLayout
// ---------------------------------------------------------------------------

describe('validateLayout', () => {
  const textComp = (content = 'hello'): ComponentConfig => ({
    type: 'text_display',
    content,
  });

  it('is valid with a few components', () => {
    const result = validateLayout([textComp(), textComp()], 'menu');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.componentCount).toBe(2);
  });

  it('is invalid when components exceed 40', () => {
    const components: ComponentConfig[] = Array.from({ length: 41 }, () =>
      textComp(),
    );
    const result = validateLayout(components, 'menu');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('41 components');
  });

  it('counts nested components inside containers', () => {
    const container: ComponentConfig = {
      type: 'container',
      children: [textComp(), textComp(), textComp()],
    };
    const result = validateLayout([container], 'menu');
    // container itself + 3 children = 4
    expect(result.componentCount).toBe(4);
  });

  it('is invalid when text exceeds 4000 characters', () => {
    const longText = 'a'.repeat(4001);
    const result = validateLayout([textComp(longText)], 'menu');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('4,001 characters');
  });

  it('is valid at exactly 4000 characters', () => {
    const exactText = 'a'.repeat(4000);
    const result = validateLayout([textComp(exactText)], 'menu');
    expect(result.valid).toBe(true);
  });

  it('accounts for reserved button budget', () => {
    // 39 text components + 2 reserved buttons = 41 total (1 row + 1 button)
    // reservedButtonCount=1 → +1 action row + 1 button = 2 reserved components
    const components: ComponentConfig[] = Array.from({ length: 39 }, () =>
      textComp(),
    );
    const result = validateLayout(components, 'menu', 1);
    expect(result.componentCount).toBe(41);
    expect(result.valid).toBe(false);
  });

  it('is valid at exactly 40 components with reserved buttons accounted', () => {
    // 38 text components + reservedButtonCount=1 → 38 + 1 row + 1 button = 40
    const components: ComponentConfig[] = Array.from({ length: 38 }, () =>
      textComp(),
    );
    const result = validateLayout(components, 'menu', 1);
    expect(result.componentCount).toBe(40);
    expect(result.valid).toBe(true);
  });

  it('returns both errors when both limits exceeded', () => {
    const longText = 'a'.repeat(4001);
    const components: ComponentConfig[] = Array.from({ length: 41 }, () =>
      textComp(longText),
    );
    const result = validateLayout(components, 'menu');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('includes menu id in error message', () => {
    const components: ComponentConfig[] = Array.from({ length: 41 }, () =>
      textComp(),
    );
    const result = validateLayout(components, 'my-layout-menu');
    expect(result.errors[0]).toContain('my-layout-menu');
  });

  it('breakdown counts text_display components', () => {
    const result = validateLayout([textComp(), textComp()], 'menu');
    expect(result.breakdown.textDisplays).toBe(2);
  });
});
