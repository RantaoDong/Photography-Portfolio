export type RgbColor = [number, number, number];
export type LabColor = [number, number, number];

export interface WeightedColor {
	lab: LabColor;
	rgb: RgbColor;
	proportion: number;
}

export interface SpatialColorCell {
	x: number;
	y: number;
	colors: WeightedColor[];
}

export interface PhotoColorFeatures {
	averageLab: LabColor;
	dominantColors: WeightedColor[];
	brightness: number;
	saturation: number;
	hueHistogram: number[];
	neutralProportion: number;
	colorDiversity: number;
	paletteConcentration: number;
	toneStrength: number;
	neutralStrength: number;
	spatialCells: SpatialColorCell[];
}

export interface ColorAnalysisSettings {
	sampleSize: number;
	dominantColorClusters: number;
	hueBinCount: number;
	spatialGridSize: [number, number];
	spatialColorsPerCell: number;
	neutralChromaThreshold: number;
	reliableHueMinimumLightness: number;
	toneHueWindowBins: number;
}

export interface PhotoColorFeatureFile {
	schemaVersion: number;
	analysisVersion: string;
	analysis: ColorAnalysisSettings;
	photos: Record<string, PhotoColorFeatures>;
}

export interface ColorMatchResult {
	score: number;
	similarity: number;
	confidence: number;
	paletteDistance: number;
	averageDistance: number;
	selectedHueCoverage: number;
}

export interface OverallColorMatchFeatures {
	averageLab: LabColor;
	dominantColors: Array<Pick<WeightedColor, 'lab' | 'proportion'>>;
	hueHistogram: number[];
	neutralProportion: number;
	toneStrength: number;
	neutralStrength: number;
}
