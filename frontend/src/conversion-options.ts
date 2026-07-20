export type ReadingOrderStrategy = "AUTO" | "STRUCT_TREE" | "XY_CUT";

export interface ConversionQualityOptions {
  readingOrder: ReadingOrderStrategy;
  includeHeaderFooter: boolean;
  keepLineBreaks: boolean;
  filterHiddenText: boolean;
  filterOutOfPage: boolean;
  filterTinyText: boolean;
  filterHiddenOcg: boolean;
}

export const DEFAULT_QUALITY_OPTIONS: ConversionQualityOptions = {
  readingOrder: "AUTO",
  includeHeaderFooter: false,
  keepLineBreaks: false,
  filterHiddenText: false,
  filterOutOfPage: true,
  filterTinyText: true,
  filterHiddenOcg: true,
};

export function conversionRequestBody(filePath: string, mode: string, options: ConversionQualityOptions) {
  return { filePath, mode, ...options };
}
