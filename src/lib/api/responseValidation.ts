export class ApiResponseValidationError extends Error {
  readonly contract: string;
  readonly path: string;

  constructor(contract: string, path: string, expected: string) {
    super(`DropDex received an unexpected ${contract} response at ${path}; expected ${expected}.`);
    this.name = 'ApiResponseValidationError';
    this.contract = contract;
    this.path = path;
  }
}

export type ApiRecord = Record<string, unknown>;

export function expectRecord(value: unknown, contract: string, path = '$'): ApiRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiResponseValidationError(contract, path, 'an object');
  }
  return value as ApiRecord;
}

export function expectArray(value: unknown, contract: string, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ApiResponseValidationError(contract, path, 'an array');
  }
  return value;
}

export function expectString(value: unknown, contract: string, path: string): string {
  if (typeof value !== 'string') {
    throw new ApiResponseValidationError(contract, path, 'a string');
  }
  return value;
}

export function expectNullableString(
  value: unknown,
  contract: string,
  path: string,
): string | null {
  if (value === null) return null;
  return expectString(value, contract, path);
}

export function expectOptionalNullableString(
  value: unknown,
  contract: string,
  path: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  return expectNullableString(value, contract, path);
}

export function expectNumber(value: unknown, contract: string, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiResponseValidationError(contract, path, 'a finite number');
  }
  return value;
}

export function expectOptionalNumber(
  value: unknown,
  contract: string,
  path: string,
): number | undefined {
  if (value === undefined) return undefined;
  return expectNumber(value, contract, path);
}

export function expectNullableNumber(
  value: unknown,
  contract: string,
  path: string,
): number | null {
  if (value === null) return null;
  return expectNumber(value, contract, path);
}

export function expectBoolean(value: unknown, contract: string, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ApiResponseValidationError(contract, path, 'a boolean');
  }
  return value;
}

export function expectOptionalBoolean(
  value: unknown,
  contract: string,
  path: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  return expectBoolean(value, contract, path);
}

export function expectStringArray(value: unknown, contract: string, path: string): string[] {
  return expectArray(value, contract, path).map((item, index) =>
    expectString(item, contract, `${path}[${index}]`));
}

export function expectOptionalStringArray(
  value: unknown,
  contract: string,
  path: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  return expectStringArray(value, contract, path);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
