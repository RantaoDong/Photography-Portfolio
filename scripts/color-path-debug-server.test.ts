import { describe, expect, it } from 'vitest';
import { colorPathTransitionDefaults } from '../src/color/color-path-transition-config.ts';
import { replaceTransitionDefaults } from './color-path-debug-server.ts';

describe('Color Path Debug default saving', () => {
	it('replaces only the centralized transition default object', () => {
		const source = [
			'const before = true;',
			'export const colorPathTransitionDefaults: ColorPathTransitionParameters = {',
			'\ttotalDurationMs: 100,',
			'};',
			'const after = true;',
		].join('\n');
		const parameters = {
			...colorPathTransitionDefaults,
			spreadIrregularity: 0.52,
		};
		const updated = replaceTransitionDefaults(source, parameters);
		expect(updated).toContain('\ttotalDurationMs: 740,');
		expect(updated).toContain('\tabstractHold: 0.54,');
		expect(updated).toContain('\trevealStart: 0.82,');
		expect(updated).toContain('\tspreadIrregularity: 0.52,');
		expect(updated).toContain('const before = true;');
		expect(updated).toContain('const after = true;');
	});
});
